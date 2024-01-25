import {NS} from '@ns';
import {magenta, money, red} from "@/_util";

export async function main(ns: NS) {
    const purchasedServers = ns.getPurchasedServers();
    const serverRams = purchasedServers.map(server => ns.getServerMaxRam(server));
    const allSameRam = serverRams.every((ram, _, arr) => ram === arr[0]);
    let targetRam;

    if (allSameRam) {
        targetRam = serverRams[0] * 2;
    } else {
        targetRam = Math.max(...serverRams);
    }

    for (const serverName of purchasedServers) {
        const currentRam = ns.getServerMaxRam(serverName);
        if (currentRam < targetRam) {
            const upgradeCost = ns.getPurchasedServerUpgradeCost(serverName, targetRam);
            if (ns.getPlayer().money >= upgradeCost) {
                ns.upgradePurchasedServer(serverName, targetRam);
                ns.tprintf("%s upgraded to %dGB for %s", magenta(serverName), targetRam, money(upgradeCost));
            } else {
                ns.printf(red(`Not enough money to upgrade ${serverName}!`));
                break;
            }
        }
    }
}
