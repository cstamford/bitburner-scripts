import {NetscriptPort, NS} from "@ns";
import {
    CoordinatorMetrics,
    CoordinatorPortData,
    dispatch,
    get_durations,
    get_required_memory,
    get_script_mem_cost, opBufferMs,
    opDebug,
    Operation,
    OperationPortFinished,
    OperationPortStarted,
    OperationPortType,
    OperationRegion, opMaxCount, opSpacerMs,
    OpType,
    read_message,
    RegionState,
    transfer_scripts,
} from "@/_mining";
import {PriorityQueue} from "@/_pqueue";
import {assert, cyan, get_server_memory, get_server_memory_max, get_time, magenta, next_prime_above} from "@/_util";
import {
    Analysis,
    AnalysisThreads,
    AnalysisThreadTypes,
    analyze,
    calculate_layout,
    format_analysis_threads,
    reanalyze_for_cores
} from "@/_mining_analysis";

const coordinatorUpdateIntervalMs= 64;

// TODO: delays stop us from lowering for now. we can probably grab 10%-15% extra RAM by optimizing this delay.
// we can solve it by keeping an incremental setTimeout rolling that dispatches jobs if we're full sec - this should cover any big gaps.
const jobSpawnAheadBufferMs = Infinity;

interface PendingOperation extends Operation {
    id: number;
    groupId: number;
    region: OperationRegion;
    threadsHome: number;

    prev?: PendingOperation;
    next?: PendingOperation;
    cancel?: () => void;
}

interface Work {
    target: string;
    workers: string[];

    startTime: number;

    portId: number;
    portWorkerStartOpId: number;
    portWorkerFinishOpId: number;
    portWorkerFinishOpBarrierId: number;

    port: NetscriptPort,
    portWorkerStartOp: NetscriptPort,
    portWorkerFinishOp: NetscriptPort,
    portWorkerFinishOpBarrier: NetscriptPort,

    analysis: Analysis,
    analysisThreadsHome: AnalysisThreads,
    analysisDurations: number[];
    analysisLayout: Operation[];
    analysisLayoutHome: Operation[];
    analysisLayoutMemory: number;
    analysisHackingSkill: number;

    operationsLookup: Map<number, PendingOperation>;
    operationsRegions: PriorityQueue<OperationRegion>;
    operationsLaunches: PriorityQueue<PendingOperation>;
    operationsIdNext: number;
    operationsGroupIdNext: number;
    operationsGroupStart: number;

    metrics: CoordinatorMetrics;
    metricsTime: number;
}

export async function main(ns: NS) {
    ns.disableLog("ALL");

    const portId = ns.args[0] as number;
    const portWorkerStartOpId = ns.args[1] as number;
    const portWorkerFinishOpId = ns.args[2] as number;
    const portWorkerFinishOpBarrierId = ns.args[3] as number;
    const target = ns.args[4] as string;
    const workers = ns.args.slice(5) as string[];

    for (const worker of workers) {
        transfer_scripts(ns, worker);
    }

    while (ns.getServerSecurityLevel(target) != ns.getServerMinSecurityLevel(target)) {
        const time = get_durations(ns, target)[OpType.Weaken];

        for (const worker of workers) {
            const threads = get_server_memory(ns, worker) / get_script_mem_cost(ns, OpType.Weaken);
            dispatch(ns, OpType.Weaken, Math.floor(threads), worker, target); // shotgun that mofo
        }

        await ns.sleep(time + 1000);
    }

    const analysis = analyze(ns, target, opBufferMs, opSpacerMs);
    const analysisThreadsHome = reanalyze_for_cores(ns, analysis, ns.getServer("home").cpuCores).threads;
    const analysisDurations = get_durations(ns, target);
    const analysisLayout = calculate_layout(analysis.threads, analysisDurations, analysis.bufferSize);
    const analysisLayoutHome = calculate_layout(analysisThreadsHome, analysisDurations, analysis.bufferSize);

    const work : Work = {
        target,
        workers,

        startTime: get_time(),

        portId,
        portWorkerStartOpId,
        portWorkerFinishOpId,
        portWorkerFinishOpBarrierId,

        port: ns.getPortHandle(portId),
        portWorkerStartOp: ns.getPortHandle(portWorkerStartOpId),
        portWorkerFinishOp: ns.getPortHandle(portWorkerFinishOpId),
        portWorkerFinishOpBarrier: ns.getPortHandle(portWorkerFinishOpBarrierId),

        analysis: analysis,
        analysisThreadsHome,
        analysisDurations,
        analysisLayout,
        analysisLayoutHome,
        analysisLayoutMemory: get_required_memory(ns, analysisLayout),
        analysisHackingSkill: ns.getHackingLevel(),

        operationsLookup: new Map(),
        operationsRegions: new PriorityQueue((a, b) => {
            if (a.end != b.end) {
                return a.end - b.end;
            }

            if (a.group != b.group) {
                return a.group - b.group;
            }

            return a.groupOrder - b.groupOrder;
        }),
        operationsLaunches: new PriorityQueue((a, b) => a.region.start - b.region.start),
        operationsIdNext: 0,
        operationsGroupIdNext: 0,
        operationsGroupStart: 0,

        metrics: {
            moneyPercent: 1,
            securityFailures: 0,

            activeJobs: 0,
            totalJobs: 0,
            oomJobs: 0,

            activeBatches: 0,
            totalBatches: 0,
            oomBatches: 0,

            realisedBatches: 0,
            delayedBatches: 0,
            cancelledBatches: 0,
        },

        metricsTime: -Infinity,
    };

    await launch_initial_batch(ns, work);

    while (true) {
        const time = get_time();

        if (work.portWorkerFinishOp.empty() && time >= work.metricsTime + coordinatorUpdateIntervalMs) {
            const oldRegions = 4;
            const regionTime = time - work.analysis.threads.stride * oldRegions

            while (!work.operationsRegions.is_empty()) {
                if (regionTime < work.operationsRegions.peek()!.end) {
                    break;
                }
                work.operationsRegions.dequeue();
            }

            const portData : CoordinatorPortData = {
                metrics: work.metrics,
                regions: work.operationsRegions.to_array().slice(0, 64)
            };

            work.port.write(JSON.stringify(portData))
            work.metricsTime = time;
        }

        await work.portWorkerFinishOp.nextWrite();

        while (!work.portWorkerFinishOp.empty()) {
            const message = read_message(work.portWorkerFinishOp);
            assert(ns, message.type == OperationPortType.Finish, "expected OperationPortType.Finish");
            await on_finish_operation(ns, work, work.operationsLookup.get(message.id)!, message as OperationPortFinished);
            work.portWorkerFinishOpBarrier.write(0);
        }
    }
}

function on_start_operation(ns: NS, work: Work, op: PendingOperation, message: OperationPortStarted) {
    //ns.tprintf("%d %8s on_start_operation(.jobCreated: %d .delay: %d)", get_time(), OpType[op.type], message.jobCreated, message.delay);
    op.region.jobCreated = message.jobCreated;

    if (!check_security(ns, work)) {
        ++work.metrics.securityFailures;
    }

    ++work.metrics.activeJobs;
    ++work.metrics.totalJobs;

    if (!op.prev) {
        ++work.metrics.activeBatches;
        ++work.metrics.totalBatches;
    }
}

async function on_finish_operation(ns: NS, work: Work, op: PendingOperation, message: OperationPortFinished) {
    //ns.tprintf("%d %8s on_finish_operation(.jobFinished: %d)", get_time(), OpType[op.type], message.jobFinished);
    op.region.jobFinished = message.jobFinished;

    --work.metrics.activeJobs;

    if (!op.next) {
        --work.metrics.activeBatches;

        if (op.region.state == RegionState.Normal) {
            ++work.metrics.realisedBatches;
        } else if (op.region.state == RegionState.Delayed) {
            ++work.metrics.realisedBatches;
            ++work.metrics.delayedBatches;
        } else if (op.region.state == RegionState.Cancelled) {
            ++work.metrics.cancelledBatches;
        }
    }

    if (op.type == OpType.Grow) {
        const curMoney = ns.getServerMaxMoney(work.target);
        const maxMoney = ns.getServerMoneyAvailable(work.target);
        const percent = maxMoney / curMoney;
        work.metrics.moneyPercent = percent * 0.001 + 0.999 * work.metrics.moneyPercent;
    }

    const fullSecurity = check_security(ns, work);

    if (fullSecurity && ns.getHackingLevel() != work.analysisHackingSkill) {
        reanalyze_work(ns, work);
        work.analysisHackingSkill = ns.getHackingLevel();
    }

    if (op.type == OpType.Weaken && op.region.state != RegionState.Stabilization &&
        (work.analysis.threads.type == AnalysisThreadTypes.Hgw || op.next?.type == OpType.Weaken)) {
        try_schedule_next_batch(ns, work);
    }

    if (fullSecurity) {
        while (!work.operationsLaunches.is_empty()) {
            const next = work.operationsLaunches.peek()!;
            if (message.jobFinished < next.region.start - jobSpawnAheadBufferMs) {
                break;
            }
            await try_dispatch_op(ns, work, work.operationsLaunches.dequeue()!);
        }
    }

    if (op.region.state == RegionState.Stabilization) {
        await try_dispatch_stabilization_weaken(ns,
            work,
            op.threads,
            op.threadsHome,
            message.jobFinished + next_prime_above(work.analysis.threads.stride),
            work.analysisDurations[OpType.Weaken]);
    }

    work.operationsLookup.delete(op.id);
}

// we launch all of the initial batches up front, which then keep themselves alive.
// TODO: launch them progressively (probably via a bunch of setTimeouts) to save memory, so we can squeeze more into fewer servers
async function launch_initial_batch(ns: NS, work: Work) {
    const firstSetLast = work.startTime + Math.max(...work.analysisLayout.map(x => x.time + x.duration))
    const theoreticalMaxBatches = (firstSetLast - work.startTime) / work.analysis.threads.stride;
    const stabilizationEveryNBatch = 5;

    let batchesAdded = 0;
    let jobsAdded = 0;
    let stabilizationJobsAdded = 0;

    work.operationsGroupStart = work.startTime + 512;
    let stabilizationStart = work.operationsGroupStart;

    while (work.operationsGroupStart < firstSetLast && jobsAdded < opMaxCount) {
        if (!try_schedule_next_batch(ns, work)) {
            break;
        }

        while (!work.operationsLaunches.is_empty()) {
            await try_dispatch_op(ns, work, work.operationsLaunches.dequeue()!);
            ++jobsAdded;
        }

        if (batchesAdded % 32 == 0) {
            await ns.sleep(0);
        }

        if (stabilizationStart < firstSetLast && (++batchesAdded % stabilizationEveryNBatch) == 0) {
            const idx = work.analysis.threads.type == AnalysisThreadTypes.Hwgw ? (stabilizationJobsAdded%2)*2 : 2;

            await try_dispatch_stabilization_weaken(ns,
                work,
                work.analysisLayout[idx].threads,
                work.analysisLayoutHome[idx].threads,
                stabilizationStart,
                work.analysisDurations[OpType.Weaken]);

            stabilizationStart += next_prime_above(work.analysis.threads.stride) * stabilizationEveryNBatch;
            ++stabilizationJobsAdded;
        }
    }

    ns.tprintf("[%s vs %s] %s %d initial batches, %d jobs, %d stabilization jobs, %.1f%% occupancy",
        cyan("KatMiner"),
        magenta(work.target),
        format_analysis_threads(ns, work.analysis.threads),
        batchesAdded,
        jobsAdded,
        stabilizationJobsAdded,
        batchesAdded / theoreticalMaxBatches * 100);
}

function try_schedule_next_batch(ns: NS, work: Work) {
    if (!try_get_worker(ns, work, work.analysisLayoutMemory)) {
        ++work.metrics.oomBatches;
        return false;
    }

    const time = get_time();
    const minBufferSize = Math.max(64 /* thread jitter */, work.analysis.threads.stride);

    while (work.operationsGroupStart < time + minBufferSize) {
        work.operationsGroupStart += work.analysis.threads.stride;
    }

    const pendingOps: PendingOperation[] = work.analysisLayout.map(((x, i) => ({
        ...x,
        id: work.operationsIdNext++,
        groupId: work.operationsGroupIdNext,
        threadsHome: work.analysisLayoutHome[i].threads,
        region: {
            type: x.type,
            state: RegionState.Normal,
            group: work.operationsGroupIdNext,
            groupOrder: x.orderExecute,
            start: work.operationsGroupStart + x.time,
            end: work.operationsGroupStart + x.time + x.duration,
            jobCreated: 0,
            jobFinished: 0,
        }
    })));

    const maxShifts = 100;
    let shift = 0;
    let shiftNum = 0;

    while (true) {
        let thisShift = 0;

        for (const op of pendingOps) {
            thisShift = Math.max(thisShift, delay_to_safe_region(ns, work, op.type, op.region.start + shift));
        }

        if (thisShift == 0 || ++shiftNum > maxShifts) {
            break;
        }

        shift += thisShift + 0.1;
    }

    for (let i = 0; i < pendingOps.length; ++i) {
        pendingOps[i].prev = pendingOps[i - 1];
        pendingOps[i].next = pendingOps[i + 1];

        if (shift > 0) {
            pendingOps[i].region.state = RegionState.Delayed;
            pendingOps[i].region.start += shift;
            pendingOps[i].region.end += shift;
        }

        work.operationsLookup.set(pendingOps[i].id, pendingOps[i]);
        work.operationsRegions.enqueue(pendingOps[i].region);
        work.operationsLaunches.enqueue(pendingOps[i]);
        //ns.tprintf("%d %8s queued for %d (shift:%d)", time, OpType[pendingOps[i].type], pendingOps[i].region.start, shift)
    }

    ++work.operationsGroupIdNext;
    work.operationsGroupStart += work.analysis.threads.stride + shift;

    return true;
}

async function try_dispatch_op(ns: NS, work: Work, op: PendingOperation) {
    const mem = get_script_mem_cost(ns, op.type) * op.threads;
    const worker = try_get_worker(ns, work, mem);

    if (worker == undefined) {
        ++work.metrics.oomJobs;
        return false;
    }

    if (op.groupId % 2 == 0) {
        if (op.type == OpType.Hack && (!check_security(ns, work) || work.metrics.moneyPercent <= 0.9)) {
            op.region.state = RegionState.Cancelled;
        } else if (op.type == OpType.Grow && work.analysisHackingSkill != ns.getHackingLevel()) {
            op.region.state = RegionState.Cancelled;
        }
    }

    op.cancel = dispatch(ns,
        op.type,
        // TODO: Do we want to prioritise home for grows/weakens?
        // TODO: I think we transition to a monolithic scheduler tbh
        worker == "home" ? op.threadsHome : op.threads,
        worker,
        work.target,
        op.region.end,
        op.duration,
        op.id,
        work.portWorkerStartOpId,
        work.portWorkerFinishOpId,
        work.portWorkerFinishOpBarrierId,
        op.region.state == RegionState.Cancelled || opDebug);

    await work.portWorkerStartOp.nextWrite();

    const message = read_message(work.portWorkerStartOp);
    assert(ns, work.portWorkerStartOp.empty(), "portWorkerStartOp is not empty. This breaks our invariant.");
    assert(ns, message.type == OperationPortType.Start, "expected OperationPortType.Start");

    on_start_operation(ns, work, op, message as OperationPortStarted);

    return true;
}

async function try_dispatch_stabilization_weaken(ns: NS, work: Work, threads: number, threadsHome: number, time: number, duration: number) {
    if (!try_get_worker(ns, work, get_script_mem_cost(ns, OpType.Weaken) * threads)) {
        return false;
    }

    const start = time;
    const end = start + duration;

    const op: PendingOperation = {
        type: OpType.Weaken,
        time: 0,
        duration,
        threads,
        threadsHome,
        orderDispatch: 0,
        orderExecute: 0,
        id: work.operationsIdNext++,
        groupId: -1,
        region: {
            type: OpType.Weaken,
            state: RegionState.Stabilization,
            group: -1,
            groupOrder: 0,
            start,
            end,
            jobCreated: 0,
            jobFinished: 0,
        }
    };

    work.operationsLookup.set(op.id, op);
    // doesn't get added to regions: we're invisible to all :)

    return try_dispatch_op(ns, work, op);
}

function try_get_worker(ns: NS, work: Work, cost: number) {
    let memory = work.workers.reduce((a, x) => a + get_server_memory(ns, x), 0)
    return memory < cost ? undefined : work.workers
        .map(x => ({server: x, memory: get_server_memory(ns, x)}))
        .filter(x => x.memory >= cost)
        .sort((a, b) => b.memory - a.memory)
        .at(0)?.server;
}

function check_security(ns: NS, work: Work) {
    const curSecurity = ns.getServerSecurityLevel(work.target);
    const minSecurity = ns.getServerMinSecurityLevel(work.target);
    return curSecurity == minSecurity;
}

function delay_to_safe_region(ns: NS, work: Work, opType: OpType, startTime: number) {
    let idx = work.operationsRegions.search(<OperationRegion>{end: startTime});
    let cur = work.operationsRegions.get(idx - 1);
    let dist = 0;

    while (cur)
    {
        if (cur.type == OpType.Weaken) {
            return dist;
        }

        cur = work.operationsRegions.get(idx++)
        const distanceToTravel = cur.end - startTime;
        dist += distanceToTravel;
    }

    return dist;
}

function reanalyze_work(ns: NS, work: Work) {
    work.analysis = analyze(ns, work.target, opBufferMs, opSpacerMs, work.analysis.threads.type);
    work.analysisThreadsHome = reanalyze_for_cores(ns, work.analysis, ns.getServer("home").cpuCores).threads;
    work.analysisDurations = get_durations(ns, work.target);
    work.analysisLayout = calculate_layout(work.analysis.threads, work.analysisDurations, work.analysis.bufferSize);
    work.analysisLayoutHome = calculate_layout(work.analysisThreadsHome, work.analysisDurations, work.analysis.bufferSize);
    work.analysisLayoutMemory = get_required_memory(ns, work.analysisLayout);
}
