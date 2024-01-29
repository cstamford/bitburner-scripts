import { NS } from '@ns';

export async function main(ns: NS) {
    const minRam = ns.args[0] as number;
    const maxRam = minRam;

    let purchasedServers = ns.getPurchasedServers();
    const maxServers = ns.getPurchasedServerLimit();

    for (let i = purchasedServers.length; i < maxServers; i++) {
        let serverName = ns.sprintf("kat-%02d", i + 1);
        const cost = ns.getPurchasedServerCost(minRam);

        if (ns.getPlayer().money < cost) {
            break;
        }

        ns.purchaseServer(serverName, minRam);
        purchasedServers.push(serverName);
        ns.tprintf("%s created", serverName);
    }

    let currentUpgradeRam = Math.max(minRam, Math.min(...ns.getPurchasedServers().map(x => ns.getServerMaxRam(x))));

    while (currentUpgradeRam <= maxRam) {
        for (let i = 0; i < purchasedServers.length; i++) {
            const serverName = purchasedServers[i];
            const currentRam = ns.getServerMaxRam(serverName);
            const cost = ns.getPurchasedServerUpgradeCost(serverName, minRam);

            if (currentRam < currentUpgradeRam && ns.getPlayer().money >= cost) {
                const success = ns.upgradePurchasedServer(serverName, currentUpgradeRam);
                if (success) {
                    ns.tprintf("Upgraded %s to %dGB RAM", serverName, currentUpgradeRam);
                }
            }
        }

        if (purchasedServers.every(server => ns.getServerMaxRam(server) >= currentUpgradeRam)) {
            currentUpgradeRam *= 2;
        } else {
            break;
        }
    }
}
