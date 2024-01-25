import {NS} from '@ns';
import {magenta, money} from "@/_util";

export async function main(ns: NS) {
    for (const server of ns.getPurchasedServers()) {
        const maxRam = ns.getServerMaxRam(server);
        const upgradeCost = ns.getPurchasedServerUpgradeCost(server, maxRam * 2);

        if (upgradeCost == -1) {
            continue;
        }

        ns.tprintf("%s %dGB (upgrade: %dGB, %s)", magenta(server), maxRam, maxRam * 2, money(upgradeCost));
    }
}
