import {NS} from "@ns";
import {get_all_controllable_hosts, get_all_hosts, get_server_memory, get_server_memory_max, red} from "@/_util";
import {
    AnalysisThreadTypes,
    Operation,
    OpType,
    SchedulerTargetBudget,
    SchedulerTargetData,
    SchedulerWorker
} from "@/_shared";

export const opDebug = false;

export enum SchedulerCommandType {
    Budget
}

export interface SchedulerCommand {
    type: SchedulerCommandType;
}

export interface SchedulerCommandBudgets extends SchedulerCommand {
    budgets: SchedulerTargetBudget[];
}

export function calculate_operation_order(descriptors: {type: OpType, time: number, threads: number}[], bufferSize: number): Operation[] {
    const indexedDescriptors = descriptors
        .map((op, index) => ({op, index}))
        .sort((a, b) => b.op.time - a.op.time);

    const longestTime = indexedDescriptors[0].op.time;
    const schedule: Array<Operation> = [];

    for (const indexedOp of indexedDescriptors) {
        const startTime = longestTime - indexedOp.op.time;

        schedule.push({
            type: indexedOp.op.type,
            time: startTime,
            timeFromEnd: 0,
            duration: indexedOp.op.time,
            threads: indexedOp.op.threads,
            orderExecute: indexedOp.index,
            orderDispatch: schedule.length,
        });
    }

    const firstDispatchedOrder = schedule[0].orderExecute;

    for (const orderedOp of schedule) {
        orderedOp.timeFromEnd = (orderedOp.orderExecute - firstDispatchedOrder) * bufferSize;
        orderedOp.time += orderedOp.timeFromEnd;
    }

    return schedule;
}

export function dispatch(ns: NS, op: OpType, threads: number, runner: string, target: string, ...data: (string | number | boolean)[]) {
    const script = get_script(op);
    const pid = ns.exec(script, runner, {threads:threads, temporary:true}, target, ...data);

    if (pid == 0) {
        const maxMem = ns.getServerMaxRam(runner);
        const mem = ns.getServerUsedRam(runner)
        ns.tprintf(red("Failed to start %s [%s] on %s (target:%s, %d/%dgb)"), script, data, runner, target, mem, maxMem);
    }

    return pid;
}

export function get_required_memory(ns: NS, ops: Operation[]) {
    return ops.reduce((a, x) => a + get_script_mem_cost(ns, x.type) * x.threads, 0);
}

export function get_durations(ns: NS, host: string) {
    const times = [
        ns.getGrowTime(host),
        ns.getWeakenTime(host),
        ns.getHackTime(host)
    ];

    if (opDebug) {
        times[0] /= 8;
        times[1] /= 8;
        times[2] /= 8;
    }

    return times;
}

export function get_script(op: OpType) {
    switch (op) {
        case OpType.Grow:
            return "/mining-scheduler-grow.js"
        case OpType.Weaken:
            return "/mining-scheduler-weaken.js"
        case OpType.Hack:
            return "/mining-scheduler-hack.js"
    }
}

export function get_script_mem_cost(ns: NS, op: OpType) {
    return ns.getScriptRam(get_script(op));
}

export function transfer_scripts(ns: NS, host: string) {
    if (host == "home") {
        return;
    }

    for (const script of ns.ls(host, ".js")) {
        ns.rm(script, host);
    }

    ns.scp(ns.ls("home", ".js"), host, "home");
}

export function make_empty_target_data(ns: NS, target: string) : SchedulerTargetData {
    const maxMoney = ns.getServerMaxMoney(target);

    return {
        target,
        prepped: false,
        budget: 0,
        budgetMinHacks: 1,
        budgetMaxHacks: 255,
        analysis: {
            host: target,
            score: 0,
            predictedTime: 0,
            predictedMemory: 0,
            predictedMemoryPeak: 0,
            predictedYield: 0,
            predictedYieldPercent: 0,
            threads: {
                type: AnalysisThreadTypes.Invalid,
                stride: -1,
            },
            bufferSize: 0
        },
        analysisDurations: [],
        analysisLayout: [],
        analysisLayoutMemory: 0,
        analysisHackingSkill: 0,
        strideForConcurrency: -1,
        maxConcurrency: -1,
        metrics: {
            money: maxMoney == 0 ? 0 : ns.getServerMoneyAvailable(target) / maxMoney,
            security: ns.getServerSecurityLevel(target) - ns.getServerMinSecurityLevel(target),
            securityFailures: 0,
            activeJobs: 0,
            queuedJobs: 0,
            totalJobs: 0,
            oomJobs: 0,
            activeBatches: 0,
            totalBatches: 0,
            realisedBatches: 0,
            cancelledBatches: 0
        }
    };
}

export function refresh_workers(ns: NS) : SchedulerWorker[] {
    const workers = get_all_controllable_hosts(ns);
    return workers.map(x => ({
        host: x,
        mem: get_server_memory(ns, x),
        maxMem: get_server_memory_max(ns, x)
    }));
}

export function refresh_targets(ns: NS) {
    return get_all_hosts(ns).filter(x => ns.getServerMaxMoney(x) > 0)
}
