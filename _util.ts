import {NS} from "@ns";

export const reservedMemoryOnHome = 32;

export const colors = {
    black: '\u001b[30m',
    red: '\u001b[31m',
    green: '\u001b[32m',
    yellow: '\u001b[33m',
    blue: '\u001b[34m',
    magenta: '\u001b[35m',
    cyan: '\u001b[36m',
    white: '\u001b[37m',
    brightBlack: '\u001b[30;1m',
    brightRed: '\u001b[31;1m',
    brightGreen: '\u001b[32;1m',
    brightYellow: '\u001b[33;1m',
    brightBlue: '\u001b[34;1m',
    brightMagenta: '\u001b[35;1m',
    brightCyan: '\u001b[36;1m',
    brightWhite: '\u001b[37;1m',
    default: '\u001b[0m',
};

export type Color = keyof typeof colors;

export function col(msg: string, color: Color): string {
    const colorCode = colors[color];
    return `${colorCode}${msg}${colors.default}`;
}

export function black(msg: string): string {
    return col(msg, "black")
}

export function red(msg: string): string {
    return col(msg, "red")
}

export function green(msg: string): string {
    return col(msg, "green")
}

export function yellow(msg: string): string {
    return col(msg, "yellow")
}

export function magenta(msg: string): string {
    return col(msg, "magenta")
}

export function cyan(msg: string): string {
    return col(msg, "cyan")
}

export function white(msg: string): string {
    return col(msg, "white")
}

export function defaultc(msg: string): string {
    return col(msg, "default")
}

export function time() {
    const date = new Date(Date.now());
    return date.toLocaleTimeString(new Intl.Locale('en-GB'));
}

export function money(money: number): string {
    if (money >= 1e12) {
        return `$${(money / 1e12).toFixed(1)}T`;
    } else if (money >= 1e9) {
        return `$${(money / 1e9).toFixed(1)}B`;
    } else if (money >= 1e6) {
        return `$${(money / 1e6).toFixed(1)}M`;
    } else if (money >= 1e3) {
        return `$${(money / 1e3).toFixed(1)}K`;
    } else {
        return `$${money.toFixed(1)}`;
    }
}

export function assert(ns: NS, condition: any, message: string): asserts condition {
    if (!condition) {
        assert_fail(ns, message);
    }
}

export function assert_fail(ns: NS, message: string) {
    ns.tprintf(red("ASSERTION FAILED (%s) %s"), ns.getScriptName(), message);
}

export async function run_async(ns: NS, script: string, threads: number, ...args: (string | number | boolean)[]) {
    const pid = ns.run(script, threads, ...args)
    assert(ns, pid != 0, "Failed to start script");

    while (ns.isRunning(pid)) {
        await ns.sleep(64);
    }
}

export function get_all_hosts(ns: NS, withRoot = true) : string[] {
    const set : Set<string> = new Set();
    get_all_hosts_impl(ns, "home", set);

    for (const host of set) {
        if (!ns.hasRootAccess(host) && ns.getHackingLevel() >= ns.getServerRequiredHackingLevel(host)) {
            let server = ns.getServer(host);

            if (!server.sshPortOpen && ns.fileExists("BruteSSH.exe")) {
                ns.brutessh(host);
            }

            if (!server.ftpPortOpen && ns.fileExists("FTPCrack.exe")) {
                ns.ftpcrack(host);
            }

            if (!server.smtpPortOpen && ns.fileExists("relaySMTP.exe")) {
                ns.relaysmtp(host);
            }

            if (!server.httpPortOpen && ns.fileExists("HTTPWorm.exe")) {
                ns.httpworm(host);
            }

            if (!server.sqlPortOpen && ns.fileExists("SQLInject.exe")) {
                ns.sqlinject(host);
            }

            server = ns.getServer(host);

            let requiredPorts = server.numOpenPortsRequired!;
            let openPorts = server.openPortCount!;

            if (openPorts >= requiredPorts) {
                ns.nuke(host);
            }
        }
    }

    return [...set].filter(x => !withRoot || ns.hasRootAccess(x));
}

export function get_all_controllable_hosts(ns: NS, withRoot = true) : string[] {
    return get_all_hosts(ns, withRoot).filter(x =>
        ns.getServer(x).backdoorInstalled ||
        ns.getServer(x).purchasedByPlayer);
}

function get_all_hosts_impl(ns: NS, host: string, visited: Set<string>) {
    if (!visited.has(host)) {
        visited.add(host);
        for (const neighbour of ns.scan(host)) {
            get_all_hosts_impl(ns, neighbour, visited);
        }
    }
}

export function get_server_memory(ns: NS, host: string) {
    return Math.max(0, get_server_memory_max(ns, host) - ns.getServerUsedRam(host));
}

export function get_server_memory_max(ns: NS, host: string) {
    if (host == "home") {
        return Math.max(0, ns.getServerMaxRam(host) - reservedMemoryOnHome);
    }
    return ns.getServerMaxRam(host);
}

export function get_time() {
    return performance.now(); //Date.now();
}

export function get_time_precise() {
    return performance.now();
}

export function next_prime_above(num: number) {
    if (num <= 1) {
        return 2;
    }

    while (true) {
        num++;
        if (is_prime(num)) {
            return num;
        }
    }
}

export function next_prime_below(num: number) {
    if (num <= 2) {
        throw new Error("There is no prime number below 2.");
    }

    while (num-- > 2) {
        if (is_prime(num)) {
            return num;
        }
    }
    return 2;
}

export function is_prime(num: number) {
    for (let i = 2; i <= Math.sqrt(num); i++) {
        if (num % i == 0) {
            return false;
        }
    }

    return true;
}
