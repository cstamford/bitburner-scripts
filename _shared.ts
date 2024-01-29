// Shared with remote - no imports!

export enum AnalysisThreadTypes {
    Invalid,
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
    predictedMemoryPeak: number; // per op
    predictedYield: number;
    predictedYieldPercent: number;
    threads: AnalysisThreads;
    bufferSize: number;
}

export enum OpType {
    Grow,
    Weaken,
    Hack
}

export interface Operation {
    type: OpType;
    time: number;
    timeFromEnd: number;
    duration: number;
    threads: number;
    orderDispatch: number;
    orderExecute: number;
}

export interface SchedulerTargetBudget {
    target: string;
    budget: number;
    budgetMinHacks: number;
}

export enum RegionState {
    Normal,
    Cancelled,
    Padding,
}

export interface SchedulerTargetData {
    target: string;
    prepped: boolean;

    budget: number;
    budgetMinHacks: number;
    budgetMaxHacks: number;

    analysis: Analysis,
    analysisDurations: number[];
    analysisLayout: Operation[];
    analysisLayoutMemory: number;
    analysisHackingSkill: number;

    strideForConcurrency: number;
    maxConcurrency: number;

    metrics: SchedulerMetrics;
}

export interface SchedulerRegion {
    type: OpType;
    state: RegionState;
    group: number;
    groupOrder: number;
    start: number;
    end: number;
    jobCreated: number;
    jobFinished: number;
}

export interface SchedulerMetrics {
    money: number;
    security: number;
    securityFailures: number;

    activeJobs: number;
    queuedJobs: number;
    totalJobs: number;
    oomJobs: number;

    activeBatches: number;
    totalBatches: number;
    realisedBatches: number;
    cancelledBatches: number;
}

export interface SocketTargetData extends SchedulerTargetData {
    backdoored: boolean;
    backdoorable: boolean;
    hackable: boolean;
    faction: boolean;
}

export interface SocketSkillData {
    hack: number;
    hackProgress: number;
    martial: number;
    martialProgress: number;
    cha: number;
    chaProgress: number;
    int: number;
    intProgress: number;
}

export interface SocketData {
    type: SocketSchedulerType;
    shares: number;
    servers: number;
    time: number;
    money: number;
    ram: number;
    skills: SocketSkillData;
    targets: SocketTargetData[];
}

export interface SchedulerWorker {
    host: string;
    mem: number;
    maxMem: number;
}

export enum SocketSchedulerType {
    None,
    Batcher,
    Drain
}

export enum SocketCommandType {
    Start,
    Budget,
    ConnectTarget,
    SetShares,
    SetServers
}

export interface SocketCommand {
    type: SocketCommandType;
}

export interface SocketCommandStart extends SocketCommand {
    schedulerType: SocketSchedulerType;
}

export interface SocketCommandBudgets extends SocketCommand {
    budgets: SchedulerTargetBudget[];
}

export interface SocketCommandServers extends SocketCommand {
    ram: number;
}

export function format_analysis_threads(threads: AnalysisThreads) {
    if (threads.type == AnalysisThreadTypes.Hwgw) {
        const hwgw = threads as AnalysisThreadsHwgw;
        return `hwgw-${hwgw.hacks}-${hwgw.weakensAfterHack}-${hwgw.grows}-${hwgw.weakensAfterGrow}`;
    }

    if (threads.type == AnalysisThreadTypes.Hgw) {
        const hgw = threads as AnalysisThreadsHgw;
        return `hgw-${hgw.hacks}-${hgw.grows}-${hgw.weakens}`;
    }

    return "";
}

export function formatBigNumber(value: number): string {
    if (value >= 1e18) {
        return `${Math.round(value / 1e18)}Q`;
    } else if (value >= 1e15) {
        return `${Math.round(value / 1e15)}q`;
    } else if (value >= 1e12) {
        return `${Math.round(value / 1e12)}t`;
    } else if (value >= 1e9) {
        return `${Math.round(value / 1e9)}b`;
    } else if (value >= 1e6) {
        return `${Math.round(value / 1e6)}m`;
    } else if (value >= 1e3) {
        return `${(value / 1e3).toFixed(1)}k`;
    } else {
        return `${value}`;
    }
}
