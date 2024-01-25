import {NetscriptPort, NS} from "@ns";
import {red} from "@/_util";

export const opDebug = false;
export const opBufferMs = 1; // between operations within schedules
export const opSpacerMs = 2;
export const opMaxCount = 200000;

export enum OpType {
    Grow,
    Weaken,
    Hack
}

export interface Operation {
    type: OpType;
    time: number;
    duration: number;
    threads: number;
    orderDispatch: number;
    orderExecute: number;
}

export enum RegionState {
    Normal,
    Delayed,
    Cancelled,
    Stabilization,
}

export interface OperationRegion {
    type: OpType;
    state: RegionState;
    group: number;
    groupOrder: number;
    start: number;
    end: number;
    jobCreated: number;
    jobFinished: number;
}

export enum OperationPortType {
    Start,
    Finish,
}

export interface OperationPort {
    type: OperationPortType;
    id: number;
}
export interface OperationPortStarted extends OperationPort {
    jobCreated: number;
    delay: number;
}

export interface OperationPortFinished extends OperationPort {
    jobFinished: number;
}

export interface CoordinatorMetrics {
    moneyPercent: number;
    securityFailures: number;

    activeJobs: number;
    totalJobs: number;
    oomJobs: number;

    activeBatches: number;
    totalBatches: number;
    oomBatches: number;

    realisedBatches: number;
    delayedBatches: number;
    cancelledBatches: number;
}

export interface CoordinatorPortData {
    regions: OperationRegion[];
    metrics: CoordinatorMetrics;
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
            duration: indexedOp.op.time,
            threads: indexedOp.op.threads,
            orderExecute: indexedOp.index,
            orderDispatch: schedule.length,
            time: startTime
        });
    }

    const firstDispatchedOrder = schedule[0].orderExecute;

    for (const orderedOp of schedule) {
        orderedOp.time = orderedOp.time + (orderedOp.orderExecute - firstDispatchedOrder) * bufferSize;
    }

    return schedule;
}

export function dispatch(ns: NS, op: OpType, threads: number, runner: string, target: string, ...data: (string | number | boolean)[]) {
    const script = get_script(op);
    const pid = ns.exec(script, runner, {threads:threads, temporary:true}, target, ...data);

    if (pid == 0) {
        ns.tprintf(red("Failed to start %s [%s] on %s (target:%s)"), script, data, runner, target);
    }

    return () => {
        ns.kill(script, runner, target, ...data);
    };
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

export function write_message(port: NetscriptPort, message: OperationPort) {
    port.write(JSON.stringify(message));
}

export function write_message_started(port: NetscriptPort, id: number, jobCreated: number, delay: number) {
    const started : OperationPortStarted = { type: OperationPortType.Start, id, jobCreated, delay };
    write_message(port, started);
}

export function write_message_finished(port: NetscriptPort, id: number, jobFinished: number) {
    const finished : OperationPortFinished = { type: OperationPortType.Finish, id, jobFinished };
    write_message(port, finished);
}

export function read_message(port: NetscriptPort) {
    return JSON.parse(port.read() as string) as OperationPort;
}
