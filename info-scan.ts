import {NS, Server} from '@ns';
import {get_all_hosts, green, magenta, red} from "@/_util";
import {transfer_scripts} from "@/_mining";

export async function main(ns: NS) {
    let backdoorable: string[][] = [];

    for (const server of get_all_hosts(ns, false)) {
        let serverPath = shortest_path_to_server(ns, server);
        const serverStatus = ns.getServer(server);

        log_server(ns,
            serverPath.length - 1,
            serverStatus,
            serverPath[1]);

        if (!ns.getServer(server).backdoorInstalled && can_backdoor(ns, serverStatus)) {
            backdoorable.push(serverPath.reverse());
        }
    }

    for (const path of backdoorable) {
        ns.tprintf("connect %s;", path.join(";connect "));
    }
}

function shortest_path_to_server(ns: NS, server: string): string[] {
    let queue: string[][] = [[server]];
    let visited: Set<string> = new Set();

    while (queue.length > 0) {
        let path = queue.shift()!;
        let node = path[path.length - 1];

        if (node == "home") {
            return path;
        }

        visited.add(node);

        let neighbours = ns.scan(node);
        for (const neighbour of neighbours) {
            if (!visited.has(neighbour)) {
                let newPath = path.slice();
                newPath.push(neighbour);
                queue.push(newPath);
            }
        }
    }

    return [];
}

function log_server(ns: NS, indent: number, server: Server, closestServer: string) {
    transfer_scripts(ns, server.hostname);

    if (!server.hasAdminRights) {
        let requiredHacking = server.requiredHackingSkill!;

        if (ns.getPlayer().skills.hacking >= requiredHacking) {
            if (!server.sshPortOpen && ns.fileExists("BruteSSH.exe")) {
                ns.brutessh(server.hostname);
            }

            if (!server.ftpPortOpen && ns.fileExists("FTPCrack.exe")) {
                ns.ftpcrack(server.hostname);
            }

            if (!server.smtpPortOpen && ns.fileExists("relaySMTP.exe")) {
                ns.relaysmtp(server.hostname);
            }

            if (!server.httpPortOpen && ns.fileExists("HTTPWorm.exe")) {
                ns.httpworm(server.hostname);
            }

            if (!server.sqlPortOpen && ns.fileExists("SQLInject.exe")) {
                ns.sqlinject(server.hostname);
            }

            server = ns.getServer(server.hostname);

            let requiredPorts = server.numOpenPortsRequired!;
            let openPorts = server.openPortCount!;

            if (openPorts >= requiredPorts) {
                ns.nuke(server.hostname);
                server = ns.getServer(server.hostname);
            }
        }
    }

    let fullName = ns.sprintf("%s (%s)", magenta(server.hostname), server.ip);
    let indentString = ' '.repeat(indent * 2);

    if (server.hasAdminRights && server.backdoorInstalled) {
        ns.tprintf("%s%s", indentString, fullName);
    } else if (server.purchasedByPlayer) {
        ns.tprintf("%s%s (owned)", indentString, fullName);
    } else {
        let ports = ns.sprintf("%s/%s ports", server.openPortCount, server.numOpenPortsRequired);
        let hacking = ns.sprintf("%s hacking skill", server.requiredHackingSkill);
        ns.tprintf("%s%s (%s, %s) via %s",
            indentString,
            fullName,
            server.openPortCount! >= server.numOpenPortsRequired! ? green(ports) : red(ports),
            ns.getPlayer().skills.hacking >= server.requiredHackingSkill! ? green(hacking) : red(hacking),
            closestServer);
    }
}

function can_backdoor(ns: NS, server: Server) {
    return ns.getPlayer().skills.hacking >= server.requiredHackingSkill! &&
        server.openPortCount! >= server.numOpenPortsRequired!;
}
