import {NetscriptPort, NS} from "@ns";
import {
    dispatch,
    get_durations,
    get_required_memory,
    get_script_mem_cost,
    make_empty_target_data,
    opDebug,
    refresh_targets,
    refresh_workers, SchedulerCommand, SchedulerCommandBudgets, SchedulerCommandType,
    transfer_scripts,
} from "@/_mining";
import {PriorityQueue} from "@/_pqueue";
import {assert, get_time, next_prime_above} from "@/_util";
import {analyze, calculate_layout} from "@/_mining_analysis";
import {
    AnalysisThreadTypes,
    OpType,
    RegionState,
    SchedulerRegion,
    SchedulerTargetData,
    SchedulerWorker
} from "@/_shared";

// bigger this number is, the more we can absorb level ups, thread jitter, frame spikes, etc
// in exchange our job duration increases by jobSpawnAheadBufferMs (from perspective of memory, not from income)
const jobSpawnAheadBufferMs = 512;

const opDebugUi = false;
const opBufferMs = 1;

interface PendingOperation {
    threads: number,
    id: number;
    groupId: number;
    region: SchedulerRegion;

    owner: Work;
    prev?: PendingOperation;
    next?: PendingOperation;

    worker?: string;
    cost?: number;
    pid?: number;
}

interface DebugUi {
    container: HTMLDivElement;
    divs: Map<string, HTMLDivElement>;
}

interface State {
    startTime: number;

    workers: SchedulerWorker[];
    targets: string[];

    metricsPortRead: NetscriptPort,
    metricsPortWrite: NetscriptPort,

    portWorkerFinishOpId: number,
    portWorkerFinishOpBarrierId: number,

    portWorkerFinishOp: NetscriptPort,
    portWorkerFinishOpBarrier: NetscriptPort,

    nextOperationsId: number;
    nextMetricsTime: number;
    nextServerUpdate: number;

    operationsLookup: Map<number, PendingOperation>;
    workLookup: Map<string, Work>;

    debugUi?: DebugUi;
}

interface Work extends SchedulerTargetData {
    operationsLaunches: PriorityQueue<PendingOperation>;
    nextReanalysis: number;
    nextOperationBatchEnd: number;
    nextOperationsGroupId: number;
}

export async function main(ns: NS) {
    ns.disableLog("ALL");

    const basePortId = ns.pid * 6;
    const readPortId = basePortId;
    const writePortId = basePortId + 1;
    const portWorkerFinishOpId = basePortId + 4;
    const portWorkerFinishOpBarrierId = basePortId + 5;

    ns.clearPort(readPortId);
    ns.clearPort(writePortId);
    ns.clearPort(portWorkerFinishOpId);
    ns.clearPort(portWorkerFinishOpBarrierId);

    const state: State = {
        startTime: get_time(),
        workers: refresh_workers(ns),
        targets: refresh_targets(ns),

        metricsPortRead: ns.getPortHandle(readPortId),
        metricsPortWrite: ns.getPortHandle(writePortId),

        portWorkerFinishOpId,
        portWorkerFinishOpBarrierId,

        portWorkerFinishOp: ns.getPortHandle(portWorkerFinishOpId),
        portWorkerFinishOpBarrier: ns.getPortHandle(portWorkerFinishOpBarrierId),

        nextOperationsId: 0,
        nextMetricsTime: 0,
        nextServerUpdate: 0,

        operationsLookup: new Map(),
        workLookup: new Map()
    };

    for (const worker of state.workers) {
        transfer_scripts(ns, worker.host);
    }

    if (opDebugUi) {
        //state.debugUi = {container: create_ui(), divs: new Map<string, HTMLDivElement>()};
    }

    enter_pump_timeout_loop(ns, state);

    while (true) {
        await state.portWorkerFinishOp.nextWrite();

        while (!state.portWorkerFinishOp.empty()) {
            const id = state.portWorkerFinishOp.read() as number;
            await on_finish_operation(ns, state, state.operationsLookup.get(id)!);
            state.portWorkerFinishOpBarrier.write(0);
        }
    }
}

function enter_pump_timeout_loop(ns: NS, state: State) {
    setTimeout(async () => {
        const time = get_time();

        let reanalyzedOne = false;

        for (const target of state.targets) {
            const work = get_target_work(ns, state, target);

            const canAnalyze = check_security(ns, work) || !work.prepped || work.analysis.threads.type == AnalysisThreadTypes.Invalid;
            const needsAnalyze = time >= work.nextReanalysis && !reanalyzedOne;

            if (canAnalyze) {
                set_work_durations(ns, work);

                if (needsAnalyze) {
                    reanalyzedOne = work.budget == 0 || ns.getHackingLevel() != work.analysisHackingSkill;

                    if (reanalyzedOne) {
                        set_work_analysis(ns, work);
                        work.analysisHackingSkill = ns.getHackingLevel();
                        work.nextReanalysis = time + (work.budget == 0 ? 60000 : 1000);
                    }
                }
            }

            if (work.budget == 0) {
                work.strideForConcurrency = -1;
                work.maxConcurrency = -1;
                continue;
            }

            const maxOpDuration = Math.max(...work.analysisLayout.map(x => x.time + x.duration)) * 2;
            const maxTheoreticalConcurrency = maxOpDuration / (work.analysis.threads.stride + 1);
            const normalizedBudget = work.budget / 100;
            const maxConcurrencyWithinMemory = state.workers.reduce((a, x) => a + x.maxMem, 0) / (work.analysis.predictedMemory * (1 - normalizedBudget + 0.1));
            const targetConcurrency = Math.min(maxTheoreticalConcurrency * normalizedBudget, maxConcurrencyWithinMemory);

            work.strideForConcurrency = Math.floor(maxOpDuration / targetConcurrency);
            work.maxConcurrency = Math.ceil(targetConcurrency);

            try_schedule_next_batch(ns, state, work);
            await launch_jobs(ns, state, work); // note: in practice, we do most of our launching via on_finish_operation
        }

        if (time >= state.nextMetricsTime) {
            while (!state.metricsPortRead.empty()) {
                const command = JSON.parse(state.metricsPortRead.read() as string) as SchedulerCommand;
                if (command.type == SchedulerCommandType.Budget) {
                    const budgets = command as SchedulerCommandBudgets;
                    for (const budget of budgets.budgets) {
                        const targetWork = get_target_work(ns, state, budget.target);
                        targetWork.budget = budget.budget;
                        targetWork.budgetMinHacks = budget.budgetMinHacks;
                        targetWork.analysisHackingSkill = 0;
                        targetWork.nextReanalysis = time;
                    }
                }
            }

            const data = Array.from(state.workLookup.values())
                .map((work: Work) => {
                    const {
                        operationsLaunches, // skip launches
                        ...targetData
                    } = work;

                    return targetData;
                });

            state.metricsPortWrite.write(JSON.stringify(data));
            state.nextMetricsTime = time + 256;
        }

        if (time >= state.nextServerUpdate) {
            state.targets = refresh_targets(ns);

            const newWorkers = refresh_workers(ns);
            const existingWorkers = new Set(state.workers.map(x => x.host));

            for (const worker of newWorkers) {
                if (!existingWorkers.has(worker.host)) {
                    transfer_scripts(ns, worker.host);
                }
            }

            state.workers = refresh_workers(ns);
            state.nextServerUpdate = time + 10000;
        }

        if (state.debugUi) {
            //requestAnimationFrame(() => update_ui(
            //    Array.from(state.operationsLookup.values()).flatMap(x => x.region),
            //    state.debugUi!.container,
            //    state.debugUi!.divs));
        }

        enter_pump_timeout_loop(ns, state);
    }, next_prime_above(4));
}

function on_start_operation(ns: NS, state: State, op: PendingOperation) {
    ++op.owner.metrics.activeJobs;
    ++op.owner.metrics.totalJobs;

    if (!op.prev) {
        ++op.owner.metrics.activeBatches;
        ++op.owner.metrics.totalBatches;
    }
}

async function on_finish_operation(ns: NS, state: State, op: PendingOperation) {
    --op.owner.metrics.activeJobs;

    if (!op.next) {
        --op.owner.metrics.activeBatches;

        if (op.region.state == RegionState.Normal) {
            ++op.owner.metrics.realisedBatches;
        } else if (op.region.state == RegionState.Cancelled) {
            ++op.owner.metrics.cancelledBatches;
        }
    }

    if (op.region.type == OpType.Weaken) {
        if (check_security(ns, op.owner)) {
            if (op.region.state != RegionState.Padding) {
                await launch_jobs(ns, state, op.owner);
            }
        } else {
            ++op.owner.metrics.securityFailures;
        }
    }

    if (op.region.type == OpType.Grow) {
        const curMoney = ns.getServerMaxMoney(op.owner.target);
        const maxMoney = ns.getServerMoneyAvailable(op.owner.target);
        const percent = maxMoney / curMoney;
        op.owner.metrics.money = percent * 0.01 + 0.99 * op.owner.metrics.money;
    }

    if (op.region.type == OpType.Weaken) {
        const curSec = ns.getServerSecurityLevel(op.owner.target);
        const minSec = ns.getServerMinSecurityLevel(op.owner.target);
        const delta = curSec - minSec;
        op.owner.metrics.security = delta * 0.01 + 0.99 * op.owner.metrics.security;
    }

    state.operationsLookup.delete(op.id);
    state.workers.find(x => x.host == op.worker)!.mem += op.cost!;
}

function try_schedule_next_batch(ns: NS, state: State, work: Work) {
    const currentJobs = work.metrics.activeJobs + work.metrics.queuedJobs;
    const time = get_time() + work.analysis.predictedTime;

    assert(ns, work.strideForConcurrency > 0, "stride must not be 0!");

    while (time - work.nextOperationBatchEnd >= 0) {
        work.nextOperationBatchEnd += work.strideForConcurrency;
    }

    if (jobSpawnAheadBufferMs + time < work.nextOperationBatchEnd) {
        return;
    }

    const pendingOps: PendingOperation[] = work.analysisLayout.map(((x, i) => ({
        ...x,
        id: state.nextOperationsId++,
        groupId: work.nextOperationsGroupId,
        owner: work,
        region: {
            type: x.type,
            state: RegionState.Normal,
            group: work.nextOperationsGroupId,
            groupOrder: x.orderExecute,
            start: work.nextOperationBatchEnd + x.timeFromEnd - x.duration,
            end: jobSpawnAheadBufferMs + work.nextOperationBatchEnd + x.timeFromEnd,
            jobCreated: 0,
            jobFinished: 0,
        }
    })));

    work.nextOperationBatchEnd += work.strideForConcurrency;
    ++work.nextOperationsGroupId;

    for (let i = 0; i < pendingOps.length; ++i) {
        pendingOps[i].prev = pendingOps[i - 1];
        pendingOps[i].next = pendingOps[i + 1];

        state.operationsLookup.set(pendingOps[i].id, pendingOps[i]);
        work.operationsLaunches.enqueue(pendingOps[i]);
        ++work.metrics.queuedJobs;
    }

    return true;
}

async function try_dispatch_op(ns: NS, state: State, op: PendingOperation) {
    const sec = check_security(ns, op.owner);
    const money = check_money(ns, op.owner);
    op.owner.prepped = op.owner.prepped || (sec && money);

    if (op.owner.prepped) {
        if (op.groupId % 2 == 0) {
            if (op.region.type == OpType.Hack && (!sec || op.owner.metrics.money <= 0.9)) {
                op.region.state = RegionState.Cancelled;
            }
        }
    } else if (sec) {
        if (op.region.type == OpType.Hack) {
            op.region.type = OpType.Grow;
            op.region.state = RegionState.Padding;
        }
    } else {
        op.region.type = OpType.Weaken;
        op.region.state = RegionState.Padding;
    }

    const mem = get_script_mem_cost(ns, op.region.type) * op.threads;
    const worker = try_get_worker(ns, state, op.region.type, mem);

    if (worker == undefined) {
        ++op.owner.metrics.oomJobs;
        return false;
    }

    op.worker = worker.host;
    op.cost = mem;
    op.pid = dispatch(ns,
        op.region.type,
        op.threads,
        worker.host,
        op.owner.target,
        op.region.end,
        op.owner.analysisDurations[op.region.type],
        op.id,
        state.portWorkerFinishOpId,
        state.portWorkerFinishOpBarrierId,
        op.region.state == RegionState.Cancelled || opDebug);

    const success = op.pid != -1;

    if (success) {
        worker.mem -= mem;
        on_start_operation(ns, state, op);

        if (op.groupId % 5 == 0 && op.region.type != OpType.Hack) {
            const end = op.region.end + next_prime_above(op.owner.strideForConcurrency);
            await try_dispatch_padding(ns, state, op.owner, op.region.type, op.threads, end);
        }
    }

    return success;
}

async function try_dispatch_padding(ns: NS, state: State, work: Work, type: OpType, threads: number, end: number) {
    const mem = get_script_mem_cost(ns, type) * threads;
    const worker = try_get_worker(ns, state, type, mem);

    if (worker == undefined) {
        return false;
    }

    const op: PendingOperation = {
        threads,
        owner: work,
        id: state.nextOperationsId++,
        groupId: -1,
        region: {
            type: type,
            state: RegionState.Padding,
            group: -1,
            groupOrder: 0,
            start: 0,
            end,
            jobCreated: 0,
            jobFinished: 0,
        }
    };

    state.operationsLookup.set(op.id, op);
    return try_dispatch_op(ns, state, op);
}

// TODO: lower core count for home for grows so we can save the memory
function try_get_worker(ns: NS, state: State, opType: OpType, cost: number) {
    const workersMem = state.workers
        .filter(x => x.mem > cost)
        .sort((a, b) => a.mem - b.mem);

    if (opType == OpType.Grow) {
        const home = workersMem.find(x => x.host == "home");
        if (home) {
            return home;
        }
    }

    const best = workersMem.at(0);
    return best?.host == "home" && workersMem.length > 1 ? workersMem.at(1) : best;
}

async function launch_jobs(ns: NS, state: State, work: Work) {
    const time = get_time();

    while (!work.operationsLaunches.is_empty()) {
        const op = work.operationsLaunches.peek()!;
        const launchTime = time - op.region.end + op.owner.analysisDurations[op.region.type];
        const launch = launchTime + jobSpawnAheadBufferMs > 0;

        let processed = false;

        if (launch && (check_security(ns, op.owner) || launchTime > -16)) {
            work.operationsLaunches.dequeue();
            if (await try_dispatch_op(ns, state, op)) {
                --op.owner.metrics.queuedJobs;
                processed = true;
            }
        }

        if (!processed) {
            break;
        }
    }
}

function check_security(ns: NS, work: Work) {
    const cur = ns.getServerSecurityLevel(work.target);
    const min = ns.getServerMinSecurityLevel(work.target);
    return cur == min;
}

function check_money(ns: NS, work: Work) {
    const cur = ns.getServerMoneyAvailable(work.target);
    const max = ns.getServerMaxMoney(work.target);
    return cur == max;
}

function get_target_work(ns: NS, state: State, target: string) {
    let work = state.workLookup.get(target);

    if (!work) {
        work = {
            operationsLaunches: new PriorityQueue<PendingOperation>(
                (a, b) => a.region.start - b.region.start),
            nextReanalysis: 0,
            nextOperationBatchEnd: 0,
            nextOperationsGroupId: 0,
            ...make_empty_target_data(ns, target),
            analysisHackingSkill: ns.getHackingLevel(),
            strideForConcurrency: -1,
            maxConcurrency: -1,
        };

        state.workLookup.set(target, work);
    }

    return work;
}

function set_work_durations(ns: NS, work: Work) {
    work.analysisDurations = get_durations(ns, work.target);
}

function set_work_analysis(ns: NS, work: Work) {
    work.analysis = analyze(ns, work.target, opBufferMs, 1, work.budgetMinHacks, work.budgetMaxHacks);
    work.analysisLayout = calculate_layout(work.analysis.threads, work.analysisDurations, work.analysis.bufferSize);
    work.analysisLayoutMemory = get_required_memory(ns, work.analysisLayout);
}
