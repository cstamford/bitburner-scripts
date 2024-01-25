import {NS} from '@ns';
import {
    AnalysisThreads,
    AnalysisThreadsHgw,
    AnalysisThreadsHwgw,
    AnalysisThreadTypes,
    calculate_layout, calculate_threads_memory,
} from "@/_mining_analysis";
import {get_all_controllable_hosts, get_time, magenta, yellow} from "@/_util";
import {dispatch, get_durations, get_script_mem_cost, opBufferMs, Operation, OpType, transfer_scripts} from "@/_mining";
import {PriorityQueue} from "@/_pqueue";

const buffer = 1;
const spacer = 2;
const launchBuffer = (buffer + spacer) * 2;

interface PendingOperation {
    orderDispatch: number;
    end: number;
    mem: number;
}

export async function main(ns : NS) : Promise<void> {
    let target = select_target(ns);
    await prep(ns, target);

    const launchQueue: PendingOperation[] = [];
    const active: PriorityQueue<number> = new PriorityQueue((a, b) => a - b);

    let lastLaunch = 0;

    while (true) {
        const workers = get_all_controllable_hosts(ns);
        const workersMaxMem = workers.reduce((a, x) => a + ns.getServerMaxRam(x), -8);
        const needNewTarget = target != select_target(ns);

        const threads = get_pre_formula_threads(ns, target);
        const durations = get_durations(ns, target);
        const maxActive = (workersMaxMem / (calculate_threads_memory(ns, threads))) * (durations[OpType.Weaken] / durations[OpType.Hack]);

        let layout: Operation[] = [];

        if (threads.type == AnalysisThreadTypes.Hwgw) {
            layout = calculate_layout(threads as AnalysisThreadsHwgw, durations, buffer);
        } else if (threads.type == AnalysisThreadTypes.Hgw) {
            layout = calculate_layout(threads as AnalysisThreadsHgw, durations, buffer);
        }

        while (!active.is_empty() && active.peek()! <= get_time()) {
            active.dequeue();
        }

        const security = ns.getServerSecurityLevel(target) - ns.getServerMinSecurityLevel(target);

        if (needNewTarget) {
            if (active.is_empty()) {
                target = select_target(ns);
            }
        } else if (security == 0 && active.length() < maxActive && get_time() >= lastLaunch + threads.stride) {
            let delay = launchBuffer;
            let highestEnd = 0;

            for (const op of layout) {
                const end = get_time() + op.time + op.duration + delay;
                const mem = op.threads * get_script_mem_cost(ns, op.type);
                launchQueue.push({orderDispatch: op.orderDispatch, end, mem});
                delay += opBufferMs;
                highestEnd = Math.max(highestEnd, end);
            }

            active.enqueue(highestEnd);
            lastLaunch = get_time();
        }

        for (let i = 0; i < launchQueue.length; ++i) {
            const next = launchQueue[i];
            const op = layout[next.orderDispatch];

            const launchTime = (next.end - op.duration) - get_time();
            if (launchTime - launchBuffer > 0) {
                if (launchTime <= 0) {
                    ns.tprintf(yellow("Dropped operation %s"), OpType[op.type]);
                    launchQueue.splice(i--, 1);
                }

                continue;
            }

            const worker = try_get_worker(ns, next.mem);

            if (worker) {
                dispatch(ns, op.type, op.threads, worker, target, next.end, op.duration);
                launchQueue.splice(i--, 1);
            }
        }

        await ns.sleep(0);
    }
}

async function prep(ns: NS, target: string) {
    ns.nuke(target);

    const weakenCost = get_script_mem_cost(ns, OpType.Weaken);
    while (ns.getServerSecurityLevel(target) != ns.getServerMinSecurityLevel(target)) {
        ns.tprintf("Prepping %s", magenta(target));

        let worker = try_get_worker(ns, weakenCost);

        while (worker) {
            const workerMem = ns.getServerMaxRam(worker) - ns.getServerUsedRam(worker);
            const threads = workerMem / weakenCost;
            dispatch(ns, OpType.Weaken, Math.floor(threads), worker, target);
            worker = try_get_worker(ns, weakenCost);
        }

        await ns.sleep(ns.getWeakenTime(target));
    }
}

function try_get_worker(ns: NS, memory: number) {
    const worker =  get_all_controllable_hosts(ns)
        .map(x => ({server: x, memory: ns.getServerMaxRam(x) - ns.getServerUsedRam(x) - (x == "home" ? 8 : 0)}))
        .filter(x => x.memory >= memory)
        .sort((a, b) => a.server == "home" ? 1 : b.server == "home" ? -1 : b.memory - a.memory)
        .map(x => x.server)
        .at(0);

    if (worker) {
        transfer_scripts(ns, worker);
    }

    return worker;
}

function select_target(ns: NS) {
    if (ns.getHackingLevel() > 175) {
        //return "foodnstuff";
    }

    return "n00dles";
}

function get_pre_formula_threads(ns: NS, target: string) : AnalysisThreads {
    if (target == "n00dles") {
        return {
            type: AnalysisThreadTypes.Hgw,
            stride: buffer*3 + spacer,
            hacks: 8,
            grows: 1,
            weakens : 1
        } as AnalysisThreads;
    }

    return {
        type: AnalysisThreadTypes.Hgw,
        stride: buffer*3 + spacer,
        hacks: 1,
        grows: 4,
        weakens : 2
    } as AnalysisThreads;
}
