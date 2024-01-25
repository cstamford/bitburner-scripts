import {NS, Player, Server} from "@ns";
import {
    calculate_operation_order,
    get_script_mem_cost,
    OpType
} from "@/_mining";

const maxHackThreads = 65535;

export enum AnalysisThreadTypes {
    Hwgw,
    Hgw
}

export interface AnalysisThreads {
    type: AnalysisThreadTypes
    stride: number
}

export interface AnalysisThreadsHwgw extends AnalysisThreads {
    hacks: number;
    weakensAfterHack: number;
    grows: number;
    weakensAfterGrow: number;
}

export interface AnalysisThreadsHgw extends AnalysisThreads {
    hacks: number;
    grows: number;
    weakens: number;
}

export interface Analysis {
    host: string,
    score: number;
    predictedTime: number;
    predictedMemory: number;
    predictedYield: number;
    predictedYieldPercent: number;
    threads: AnalysisThreads;
    bufferSize: number;
    spacerSize: number;
    scoreFn: (ns: NS, pYield: number, pMem: number, pTime: number) => number;
}

export function analyze(ns: NS,
    host: string,
    bufferSize: number,
    spacerSize: number,
    type: AnalysisThreadTypes | undefined = undefined,
    cores: number | undefined = undefined,
    scoreFn: (ns: NS, pYield: number, pMem: number, pTime: number) => number = calculate_server_score) {
    if (ns.fileExists("Formulas.exe", "home")) {
        let analysis = analyze_hwgw(ns, host, 1, bufferSize, spacerSize, cores, scoreFn);

        for (let i = 2; i < maxHackThreads; ++i) {
            const candidates: Analysis[] = [
                analyze_hwgw(ns, host, i, bufferSize, spacerSize, cores, scoreFn),
                analyze_hgw(ns, host, i, bufferSize, spacerSize, cores, scoreFn)
            ];

            const candidate = candidates
                .filter(x => !type || type == x.threads.type)
                .filter(x => x.score > analysis.score)
                .sort((a, b) => b.score - a.score)
                .at(0);

            if (candidate) {
                analysis = candidate;
            } else {
                break;
            }
        }

        return analysis;
    }

    return estimate_hgw(ns, host, bufferSize, spacerSize, cores, scoreFn);
}

export function reanalyze_for_cores(ns: NS, prev: Analysis, cores: number) {
    if (!ns.fileExists("Formulas.exe", "home")) {
        return prev;
    }

    let analysis: Analysis | undefined = undefined;

    for (let i = 1; i < maxHackThreads; ++i) {
        const candidates: Analysis[] = [
            analyze_hwgw(ns, prev.host, i, cores, prev.bufferSize, prev.spacerSize, prev.scoreFn),
            analyze_hgw(ns, prev.host, i, cores, prev.bufferSize, prev.spacerSize, prev.scoreFn)
        ];

        const candidate = candidates.find(x => prev.threads.type == x.threads.type);

        if ((candidate?.predictedMemory || 0) <= prev.predictedMemory) {
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
    spacerSize: number,
    cores: number | undefined,
    scoreFn: (ns: NS, pYield: number, pMem: number, pTime: number) => number) : Analysis {
    const server = init_server(ns, host);
    const player = ns.getPlayer();

    const hackAmount = ns.formulas.hacking.hackPercent(server, player) * hacks;
    server.moneyAvailable! -= hackAmount * server.moneyMax!;

    const weakensAfterHack = calculate_weaken_threads(ns, ns.hackAnalyzeSecurity(hacks), cores);
    const grows = ns.formulas.hacking.growThreads(server, player, server.moneyMax!, cores);
    const weakensAfterGrow = calculate_weaken_threads(ns, ns.growthAnalyzeSecurity(grows, undefined, cores), cores);

    const threads: AnalysisThreadsHwgw = {
        type: AnalysisThreadTypes.Hwgw,
        stride: bufferSize * 4 + spacerSize,
        hacks,
        weakensAfterHack,
        grows,
        weakensAfterGrow
    };

    const predictedTime = Math.max(
        Math.ceil(ns.formulas.hacking.growTime(server, player)),
        Math.ceil(ns.formulas.hacking.weakenTime(server, player)),
        Math.ceil(ns.formulas.hacking.hackTime(server, player)),
    );

    const predictedMemory = calculate_threads_memory(ns, threads);
    const predictedYield = server.moneyMax! * hackAmount * ns.formulas.hacking.hackChance(server, player);
    const predictedYieldPercent = hackAmount;

    return {
        host,
        score: scoreFn(ns, predictedYield, predictedMemory, predictedTime),
        predictedTime,
        predictedMemory,
        predictedYield,
        predictedYieldPercent,
        threads,
        bufferSize,
        spacerSize,
        scoreFn
    };
}

export function analyze_hgw(
    ns: NS,
    host: string,
    hacks: number,
    bufferSize: number,
    spacerSize: number,
    cores: number | undefined,
    scoreFn: (ns: NS, pYield: number, pMem: number, pTime: number) => number) : Analysis {
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
        stride: bufferSize * 3 + spacerSize,
        hacks,
        grows,
        weakens
    };

    const predictedTime = Math.max(
        Math.ceil(ns.formulas.hacking.growTime(server, player)),
        Math.ceil(ns.formulas.hacking.weakenTime(server, player)),
        Math.ceil(ns.formulas.hacking.hackTime(server, player)),
    );

    const predictedMemory = calculate_threads_memory(ns, threads);
    const predictedYield = server.moneyMax! * hackAmount * ns.formulas.hacking.hackChance(server, player);
    const predictedYieldPercent = hackAmount;

    return {
        host,
        score: scoreFn(ns, predictedYield, predictedMemory, predictedTime),
        predictedTime,
        predictedMemory,
        predictedYield,
        predictedYieldPercent,
        threads,
        bufferSize,
        spacerSize,
        scoreFn
    };
}

// for n00dles! (pre BN for formulas)
export function estimate_hgw(
    ns: NS,
    host: string,
    bufferSize: number,
    spacerSize: number,
    cores: number | undefined,
    scoreFn: (ns: NS, pYield: number, pMem: number, pTime: number) => number) : Analysis {

    let hacks = 8;
    let grows = 1;
    let weakens = 1;

    const threads: AnalysisThreadsHgw = {
        type: AnalysisThreadTypes.Hgw,
        stride: bufferSize * 3 + spacerSize,
        hacks,
        grows,
        weakens
    };

    const predictedTime = Math.max(
        Math.ceil(ns.getGrowTime(host)),
        Math.ceil(ns.getWeakenTime(host)),
        Math.ceil(ns.getHackTime(host)),
    );

    const predictedMemory = calculate_threads_memory(ns, threads);
    const hackAmount = ns.hackAnalyze(host) * hacks;
    const predictedYield = ns.getServerMaxMoney(host) * hackAmount * ns.hackAnalyzeChance(host);
    const predictedYieldPercent = hackAmount;

    return {
        host,
        score: scoreFn(ns, predictedYield, predictedMemory, predictedTime),
        predictedTime,
        predictedMemory,
        predictedYield,
        predictedYieldPercent,
        threads,
        bufferSize,
        spacerSize,
        scoreFn
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

export function calculate_weaken_threads(ns: NS, delta: number, cores: number | undefined) {
    let threads = 1;
    while (ns.weakenAnalyze(threads, cores) <= delta) {
        ++threads;
    }
    return threads + 1;
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
    return predictedYield / Math.pow(predictedMemory, 0.8) / predictedTime;
}

export function format_analysis_threads(ns: NS, threads: AnalysisThreads) {
    if (threads.type == AnalysisThreadTypes.Hwgw) {
        const hwgw = threads as AnalysisThreadsHwgw;
        return ns.sprintf("hwgw%d-%d/%d/%d/%d", hwgw.stride, hwgw.hacks, hwgw.weakensAfterHack, hwgw.grows, hwgw.weakensAfterGrow);
    }

    if (threads.type == AnalysisThreadTypes.Hgw) {
        const hgw = threads as AnalysisThreadsHgw;
        return ns.sprintf("hgw%d-%d/%d/%d", hgw.stride, hgw.hacks, hgw.grows, hgw.weakens);
    }

    return "";
}

export function calculate_threads_memory(ns: NS, threads: AnalysisThreads) {
    if (threads.type == AnalysisThreadTypes.Hwgw) {
        const hwgw = threads as AnalysisThreadsHwgw;
        return get_script_mem_cost(ns, OpType.Hack) * hwgw.hacks +
            get_script_mem_cost(ns, OpType.Weaken) * hwgw.weakensAfterHack +
            get_script_mem_cost(ns, OpType.Grow) * hwgw.grows +
            get_script_mem_cost(ns, OpType.Weaken) * hwgw.weakensAfterGrow;
    }

    if (threads.type == AnalysisThreadTypes.Hgw) {
        const hgw = threads as AnalysisThreadsHgw;
        return get_script_mem_cost(ns, OpType.Hack) * hgw.hacks +
            get_script_mem_cost(ns, OpType.Grow) * hgw.grows +
            get_script_mem_cost(ns, OpType.Weaken) * hgw.weakens;
    }

    return -1;
}
