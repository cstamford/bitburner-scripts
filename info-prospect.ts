import {NS} from '@ns';
import {get_all_hosts, magenta, money, red} from "@/_util";
import {
    analyze,
    format_analysis_threads,
    reanalyze_for_cores
} from "@/_mining_analysis";
import {opBufferMs, opSpacerMs} from "@/_mining";

export async function main(ns: NS) {
    const servers = get_all_hosts(ns)
        .filter(x => ns.getServerMaxMoney(x) > 0)
        .map(x => ({host: x, analysis: analyze(ns, x, opBufferMs, opSpacerMs, ns.args[0] as number)}))
        .sort((a, b) => (b.analysis?.score||0) - (a.analysis?.score||0));

    const homeCores = ns.getServer("home").cpuCores!;
    const maxScore = Math.max(...servers.map(x => x.analysis?.score||0));

    for (const data of servers) {
        if (data.analysis == undefined) {
            ns.tprintf("%s", red(data.host));
            continue;
        }

        ns.tprintf("%.2f %s c1:%s c%d:%s (%s %.2f%%, %dGB, %.2fs)",
            data.analysis.score / maxScore,
            magenta(data.host),
            format_analysis_threads(ns, data.analysis.threads),
            homeCores,
            format_analysis_threads(ns, reanalyze_for_cores(ns, data.analysis, homeCores).threads),
            money(data.analysis.predictedYield),
            data.analysis.predictedYieldPercent * 100,
            data.analysis.predictedMemory,
            data.analysis.predictedTime / 1000)
    }
}
