import {NS} from "@ns";

export function listElements(ns: NS): void {
    const elements = Array.from(document.querySelectorAll('*'))
    for (const element of elements) {
        if (element.id == "") {
            continue;
        }
        const rect = element.getBoundingClientRect();
        ns.tprintf("%s x:%.2f y:%.2f w:%.2f h:%.2f",
            element.id, rect.x, rect.y, rect.width, rect.height);

        let i = 0;
        let parent = element.parentElement;
        while (parent != undefined) {
            ns.tprintf("%s %s %s", ' '.repeat(++i * 2), parent.id, parent.className);
            parent = parent.parentElement;
        }
    }
}

interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export function get_terminal_rect() : Rect {
    return document.getElementById("terminal")!
        .closest(".jss1")!
        .getBoundingClientRect();
}

export function get_overview_box_rect() : Rect {
    return document.getElementById("overview-extra-hook-0")!
        .closest(".MuiPaper-root")!
        .getBoundingClientRect();
}
