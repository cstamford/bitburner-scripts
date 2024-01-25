import {NS} from '@ns';
import {col, defaultc, get_all_hosts, green, magenta, money} from "@/_util";

export async function main(ns: NS) {
    const servers = get_all_hosts(ns, false).sort();

    for (const server of servers) {
        const info = ns.getServer(server);
        if (info.backdoorInstalled) {
            let moneyPercent = Math.ceil(info.moneyAvailable! / info.moneyMax! * 100);
            let moneyFmt = ns.sprintf("%s/%s", money(info.moneyAvailable!), money(info.moneyMax!));

            let securityDelta = info.hackDifficulty! - info.minDifficulty!;
            let securityFmt = ns.sprintf("security %d", securityDelta);

            let files = ns.ls(server)
                .filter(file => !file.endsWith(".js"))
                .map(file => col(file, "cyan"));

            ns.tprintf("%s (%s, %s) %s",
                magenta(server),
                moneyPercent == 100 ? green(moneyFmt) : defaultc(moneyFmt),
                securityDelta == 0.0 ? green(securityFmt) : defaultc(securityFmt),
                files.join(", "));
        }
    }
}
