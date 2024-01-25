import {NetscriptPort, NS} from "@ns";
import {
    CoordinatorPortData, opBufferMs, opMaxCount, opSpacerMs,
} from "@/_mining";
import {
    get_all_controllable_hosts,
    get_all_hosts,
    get_server_memory_max, get_time,
    green,
    magenta
} from "@/_util";
import {
    basePortScheduler,
    basePortSchedulerWorkerFinishOp,
    basePortSchedulerWorkerFinishOpBarrier,
    basePortSchedulerWorkerStartOp
} from "@/_ports";
import {create_ui, create_ui_metrics, update_metrics_ui, update_ui} from "./_mining_ui";
import {Analysis, AnalysisThreads, analyze} from "@/_mining_analysis";

const showDebugWindow = false;

interface TargetDescriptor {
    target: string;
    workers: string[];
    analysis: Analysis,
    analysisThreads: AnalysisThreads,
    schedulerPort: number;
    schedulerPortWorkerStartOp: number;
    schedulerPortWorkerFinishOp: number;
    schedulerPortWorkerFinishOpBarrier: number;
}

interface DescriptorRuntime {
    desc: TargetDescriptor;
    port: NetscriptPort;
    portData?: CoordinatorPortData;
}

export async function main(ns: NS) {
    ns.disableLog("ALL");

    const descriptors = assign_workers_to_target(ns);
    const descriptorRuntimes : DescriptorRuntime[] = [];

    for (let i = 0; i < descriptors.length; i++) {
        const descriptor = descriptors[i];

        if (descriptor.workers.length == 0) {
            continue;
        }

        ns.run(
            "/mining-scheduler.js",
            1,
            descriptor.schedulerPort,
            descriptor.schedulerPortWorkerStartOp,
            descriptor.schedulerPortWorkerFinishOp,
            descriptor.schedulerPortWorkerFinishOpBarrier,
            descriptor.target,
            ...descriptor.workers);

        descriptorRuntimes.push({
            desc: descriptor,
            port: ns.getPortHandle(descriptor.schedulerPort)
        });
    }

    const container = showDebugWindow ? create_ui() : undefined;


    const divs = new Map<string, HTMLDivElement>();
    const startTime = get_time();

    while (true) {
        for (let i = 0; i < descriptorRuntimes.length; ++i) {
            const rt = descriptorRuntimes[i];

            while (!rt.port.empty()) {
                rt.portData = JSON.parse(rt.port.read() as string) as CoordinatorPortData;
            }

            if (!rt.portData) {
                continue;
            }

            if (!document.getElementById('metricsTable')) {
                create_ui_metrics(
                    document.querySelector("#root > div.MuiBox-root.css-1ik4laa > div.jss1.MuiBox-root.css-0")!,
                    descriptorRuntimes.map(x => x.desc.target));
            }

            update_metrics_ui(i, startTime, rt.desc.analysis, rt.portData.metrics);
        }

        if (container && descriptorRuntimes[0].portData) {
            requestAnimationFrame(() => update_ui(descriptorRuntimes[0].portData!.regions, container!, divs));
        }

        await ns.sleep(0);
    }
}

function assign_workers_to_target(ns: NS) : TargetDescriptor[] {
    const workers = get_all_controllable_hosts(ns)
        .map(x => ({host: x, mem: ns.getServerMaxRam(x)}))
        .sort((a, b) => b.mem - a.mem);

    const targetServers = get_all_hosts(ns)
        .filter(x => ns.args.length == 0 || ns.args.includes(x))
        .filter(x => ns.getServerMaxMoney(x) > 0)
        .map(x => ({ host: x, analysis: analyze(ns, x, opBufferMs, opSpacerMs) }))
        .sort((a, b) => b.analysis.score - a.analysis.score);

    const totalWorkerMemory = workers.reduce((a, x) => a + x.mem, 0);
    ns.tprintf("Total memory: %dGB", totalWorkerMemory);

    const assignments: TargetDescriptor[] = [];

    for (const data of targetServers) {
        if (ns.getServerSecurityLevel(data.host) != ns.getServerMinSecurityLevel(data.host) &&
            ns.getWeakenTime(data.host) >= 1000*60*5) {
            continue;
        }

        let instances = Math.min(opMaxCount, data.analysis.predictedTime / data.analysis.threads.stride);

        const descriptor: TargetDescriptor = {
            target: data.host,
            workers: [],
            analysis: data.analysis,
            analysisThreads: data.analysis.threads,
            schedulerPort: basePortScheduler + assignments.length,
            schedulerPortWorkerStartOp: basePortSchedulerWorkerStartOp + assignments.length,
            schedulerPortWorkerFinishOp: basePortSchedulerWorkerFinishOp + assignments.length,
            schedulerPortWorkerFinishOpBarrier: basePortSchedulerWorkerFinishOpBarrier + assignments.length,
        };

        for (let i = 0; i < workers.length && instances > 0; ++i) {
            const worker = workers[i];
            const workerInstances = worker.mem / data.analysis.predictedMemory;
            const workerInstancesToUse = Math.floor(Math.min(workerInstances, instances));

            if (workerInstancesToUse >= 1) {
                descriptor.workers.push(worker.host);
                instances -= workerInstancesToUse;
                workers.shift()
                --i;
            }
        }

        assignments.push(descriptor);
    }

    return assignments;
}
