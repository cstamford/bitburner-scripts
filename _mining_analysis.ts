import {NS, Server} from "@ns";
import {
    calculate_operation_order,
    get_script_mem_cost, opDebug,
} from "@/_mining";
import {Analysis, AnalysisThreads, AnalysisThreadsHgw, AnalysisThreadsHwgw, AnalysisThreadTypes, OpType} from "@/_shared";

export function analyze(ns: NS,
    host: string,
    bufferSize: number,
    cores: number | undefined = undefined,
    minHacks: number = 1,
    maxHacks: number = 256) {
    let analysis: Analysis | undefined = undefined;

    ns.tprintf("Analysis %s", host);
    for (let i = minHacks; i <= maxHacks; ++i) {
        const candidates: Analysis[] = [
            analyze_hwgw(ns, host, i, bufferSize, cores),
            analyze_hgw(ns, host, i, bufferSize, cores)
        ];

        const candidate = candidates
            .filter(x => x.score > (analysis?.score ?? 0))
            .sort((a, b) => b.score - a.score)
            .at(0);

        if (candidate) {
            analysis = candidate;
        } else {
            break;
        }
    }

    return analysis!;
}

export function analyze_hwgw(
    ns: NS,
    host: string,
    hacks: number,
    bufferSize: number,
    cores: number | undefined) : Analysis {
    const server = init_server(ns, host);
    const player = ns.getPlayer();

    const hackAmount = ns.formulas.hacking.hackPercent(server, player) * hacks;
    server.moneyAvailable! -= hackAmount * server.moneyMax!;

    const weakensAfterHack = calculate_weaken_threads(ns, ns.hackAnalyzeSecurity(hacks), cores);
    const grows = ns.formulas.hacking.growThreads(server, player, server.moneyMax!, cores);
    const weakensAfterGrow = calculate_weaken_threads(ns, ns.growthAnalyzeSecurity(grows, undefined, cores), cores);

    const threads: AnalysisThreadsHwgw = {
        type: AnalysisThreadTypes.Hwgw,
        stride: bufferSize * 4,
        hacks,
        weakensAfterHack,
        grows,
        weakensAfterGrow
    };

    const predictedTime = Math.max(
        Math.ceil(ns.formulas.hacking.growTime(server, player) / (opDebug ? 8 : 1)),
        Math.ceil(ns.formulas.hacking.weakenTime(server, player) / (opDebug ? 8 : 1)),
        Math.ceil(ns.formulas.hacking.hackTime(server, player) / (opDebug ? 8 : 1)),
    );

    const threadsMemory = calculate_threads_memory(ns, threads);
    const predictedYield = server.moneyMax! * hackAmount * ns.formulas.hacking.hackChance(server, player);
    const predictedYieldPercent = hackAmount;

    return {
        host,
        score: calculate_server_score(ns, predictedYield, threadsMemory.total, predictedTime),
        predictedTime,
        predictedMemory: threadsMemory.total,
        predictedMemoryPeak: threadsMemory.peak,
        predictedYield,
        predictedYieldPercent,
        threads,
        bufferSize
    };
}

export function analyze_hgw(
    ns: NS,
    host: string,
    hacks: number,
    bufferSize: number,
    cores: number | undefined) : Analysis {
    const server = init_server(ns, host);
    const player = ns.getPlayer();

    const hackAmount = ns.formulas.hacking.hackPercent(server, player) * hacks;
    server.moneyAvailable! -= hackAmount * server.moneyMax!;

    const hackSecurityDrop = ns.hackAnalyzeSecurity(hacks);
    server.hackDifficulty! += hackSecurityDrop;

    const grows = ns.formulas.hacking.growThreads(server, player, server.moneyMax!, cores);
    const growSecurityDrop = ns.growthAnalyzeSecurity(grows, undefined, cores);
    const weakens = calculate_weaken_threads(ns,hackSecurityDrop + growSecurityDrop, cores);

    const threads: AnalysisThreadsHgw = {
        type: AnalysisThreadTypes.Hgw,
        stride: bufferSize * 3,
        hacks,
        grows,
        weakens
    };

    const predictedTime = Math.max(
        Math.ceil(ns.formulas.hacking.growTime(server, player) / (opDebug ? 8 : 1)),
        Math.ceil(ns.formulas.hacking.weakenTime(server, player) / (opDebug ? 8 : 1)),
        Math.ceil(ns.formulas.hacking.hackTime(server, player) / (opDebug ? 8 : 1)),
    );

    const threadsMemory = calculate_threads_memory(ns, threads);
    const predictedYield = server.moneyMax! * hackAmount * ns.formulas.hacking.hackChance(server, player);
    const predictedYieldPercent = hackAmount;

    return {
        host,
        score: calculate_server_score(ns, predictedYield, threadsMemory.total, predictedTime),
        predictedTime,
        predictedMemory: threadsMemory.total,
        predictedMemoryPeak: threadsMemory.peak,
        predictedYield,
        predictedYieldPercent,
        threads,
        bufferSize
    };
}

export function init_server(ns: NS, host: string) : Server {
    const server = ns.formulas.mockServer();
    server.moneyMax = ns.getServerMaxMoney(host);
    server.moneyAvailable = server.moneyMax;
    server.minDifficulty = ns.getServerMinSecurityLevel(host);
    server.baseDifficulty = ns.getServerBaseSecurityLevel(host);
    server.hackDifficulty = server.minDifficulty;
    server.serverGrowth = ns.getServerGrowth(host);
    server.hasAdminRights = true;
    server.backdoorInstalled = true;
    server.requiredHackingSkill = ns.getServerRequiredHackingLevel(host);
    return server;
}

export function calculate_weaken_threads(ns: NS, delta: number, cores: number | undefined = undefined) {
    let threads = 1;
    while (ns.weakenAnalyze(threads, cores) <= (delta + 0.02)) {
        ++threads;
    }
    return threads;
}

export function calculate_weakens_for_prep(ns: NS, host: string) {
    const secDelta = ns.getServerSecurityLevel(host) - ns.getServerMinSecurityLevel(host);
    return calculate_weaken_threads(ns, secDelta);
}

export function calculate_layout(threads: AnalysisThreads, durations: number[], bufferSize: number) {
    if (threads.type == AnalysisThreadTypes.Hwgw) {
        return calculate_hwgw(threads as AnalysisThreadsHwgw, durations, bufferSize);
    } else if (threads.type == AnalysisThreadTypes.Hgw) {
        return calculate_hgw(threads as AnalysisThreadsHgw, durations, bufferSize);
    } else {
        return [];
    }
}

export function calculate_hwgw(threads: AnalysisThreadsHwgw, durations: number[], bufferSize: number) {
    return calculate_operation_order([
        {type: OpType.Hack, time: durations[OpType.Hack], threads: threads.hacks},
        {type: OpType.Weaken, time: durations[OpType.Weaken], threads: threads.weakensAfterHack},
        {type: OpType.Grow, time: durations[OpType.Grow], threads: threads.grows},
        {type: OpType.Weaken, time: durations[OpType.Weaken], threads: threads.weakensAfterGrow}
    ], bufferSize);
}

export function calculate_hgw(threads: AnalysisThreadsHgw, durations: number[], bufferSize: number) {
    return calculate_operation_order([
        {type: OpType.Hack, time: durations[OpType.Hack], threads: threads.hacks},
        {type: OpType.Grow, time: durations[OpType.Grow], threads: threads.grows},
        {type: OpType.Weaken, time: durations[OpType.Weaken], threads: threads.weakens}
    ], bufferSize);
}

export function calculate_server_score(ns: NS, predictedYield: number, predictedMemory: number, predictedTime: number) {
    return predictedYield / predictedMemory / predictedTime;
}

export function calculate_threads_memory(ns: NS, threads: AnalysisThreads) {
    if (threads.type == AnalysisThreadTypes.Hwgw) {
        const hwgw = threads as AnalysisThreadsHwgw;
        const h = get_script_mem_cost(ns, OpType.Hack) * hwgw.hacks;
        const w1 = get_script_mem_cost(ns, OpType.Weaken) * hwgw.weakensAfterHack;
        const g = get_script_mem_cost(ns, OpType.Grow) * hwgw.grows;
        const w2 = get_script_mem_cost(ns, OpType.Weaken) * hwgw.weakensAfterGrow;
        return { total: h + w1 + g + w2, peak: Math.max(h, w1, g, w2) };
    }

    if (threads.type == AnalysisThreadTypes.Hgw) {
        const hgw = threads as AnalysisThreadsHgw;
        const h = get_script_mem_cost(ns, OpType.Hack) * hgw.hacks;
        const g = get_script_mem_cost(ns, OpType.Grow) * hgw.grows;
        const w = get_script_mem_cost(ns, OpType.Weaken) * hgw.weakens;
        return { total: h + g + w, peak: Math.max(h, g, w) };
    }

    return { total: -1, peak: -1 };
}
