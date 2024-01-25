import {NS} from '@ns';

export async function main(ns: NS){
    while (true) {
        await ns.sleep(5000);

        if (ns.getPlayer().money < 1000000) {
            continue;
        }

        let purchasedServers = ns.getPurchasedServers();

        for (let i = purchasedServers.length; i < 25; i++) {
            let serverName = ns.sprintf("kat-%s", String(i + 1).padStart(2, '0'));

            if (ns.getServerMoneyAvailable("home") < ns.getPurchasedServerCost(1)) {
                break;
            }

            ns.purchaseServer(serverName, 1);
            purchasedServers.push(serverName);
            ns.tprintf("%s created", serverName);
        }

        const maxRam = ns.getPurchasedServerMaxRam();

        for (const serverName of purchasedServers) {
            let currentRam = ns.getServerMaxRam(serverName);
            while (currentRam < maxRam) {
                const nextRam = currentRam * 2;
                const cost = ns.getPurchasedServerCost(nextRam);

                if (ns.getServerMoneyAvailable("home") < cost) {
                    break;
                }

                ns.upgradePurchasedServer(serverName, nextRam);
                currentRam = nextRam;
            }
        }
    }
}
