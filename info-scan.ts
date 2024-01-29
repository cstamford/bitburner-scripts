import {NS, Server} from '@ns';
import {cyan, defaultc, get_all_hosts, green, magenta, red} from "@/_util";
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
        for (let i = 0; i < path.length; ++i) {
            if (path[i] == "CSEC" ||
                path[i] == "avmnite-02h" ||
                path[i] == "I.I.I.I" ||
                path[i] == "run4theh111z" ||
                path[i] == "w0r1d_d43m0n")
            {
                path[i] = cyan(path[i]);
            }
        }

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
