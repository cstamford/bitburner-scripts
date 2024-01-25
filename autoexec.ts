import {NS} from '@ns';
import {concurrentShareMemoryPerOne, concurrentShareThreads, yellow} from "@/_util";

export async function main(ns: NS) {
    ns.run("/info-scan.js");
    await ns.sleep(500);

    const homeRam = ns.getServerMaxRam("home");

    ns.run("/background-hacknet.js");
    await ns.sleep(500);

    //ns.run("/background-servers.js");
    //await ns.sleep(500);

    if (homeRam > 32) {
        const shareThreads = Math.min(
            Math.floor((homeRam * 0.25) / concurrentShareMemoryPerOne),
            concurrentShareThreads);
        if (shareThreads > 0) {
            ns.run("/background-share.js", shareThreads);
            await ns.sleep(500);
        }
    }

    ns.tprintf("Share power:%.2f%%", ns.getSharePower() * 100);

    if (ns.getServerMaxRam("home") <= 512) {
        ns.run("/background-hack.js"); // early game hack script
    }
}
