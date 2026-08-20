#!/usr/bin/env python3
"""Structural guard for the finance page.

Written after a scripted restructure of finance-new.html left an orphan open
<div>, which closed #sectionsList early and swallowed five .nc-overlay modals
into #finPanelSaude. display:none is inherited, so a modal parked inside a
hidden tab panel renders invisible with NO console error and its click handler
still runs -- the exact failure mode that costs an afternoon to find by hand.

A <div> open/close COUNT stays balanced through that bug and proves nothing.
This walks the tag stack instead and asserts three things:

  1. the document has no mismatched/unclosed tags
  2. every .nc-overlay sits at body level, never inside a finPanel* panel
  3. every [data-section-id] card is inside #sectionsList, and #acctGrid is NOT
     (balances are pinned and must never be collapsible)

Usage: python3 scripts/check-finance-structure.py finance-new.html
"""
from html.parser import HTMLParser
import io, sys

VOID = {'area','base','br','col','embed','hr','img','input','link','meta',
        'param','source','track','wbr'}

EXPECTED_SECTIONS = {
    "overdue","budgets","attention","forward","bills",
    "ownerpay","linked","transfers","charts","transactions",
}

# Pre-existing and intentional: this one belongs to the Faturas panel.
ALLOWED_PANEL_OVERLAYS = {"newCatOverlay": "finPanelFaturas"}

# Overlays that must exist AND must never drift into a tab panel.
REQUIRED_OVERLAYS = {"promptCopiedOverlay", "interviewDoneOverlay"}


class Checker(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.errors = []
        self.sections = {}
        self.acct_in_list = None
        self.overlays = set()

    def handle_starttag(self, tag, attrs):
        if tag in VOID:
            return
        d = dict(attrs)
        self.stack.append((tag, d.get('id'), self.getpos()[0]))
        ids = [x[1] for x in self.stack]

        sid = d.get('data-section-id')
        if sid:
            self.sections[sid] = 'sectionsList' in ids

        if d.get('id') == 'acctGrid':
            self.acct_in_list = 'sectionsList' in ids

        if 'nc-overlay' in (d.get('class') or ''):
            oid = d.get('id')
            if oid:
                self.overlays.add(oid)
            panels = [i for i in ids if i and i.startswith('finPanel')]
            allowed = ALLOWED_PANEL_OVERLAYS.get(oid)
            bad = [p for p in panels if p != allowed]
            if bad:
                self.errors.append(
                    "overlay #%s is nested inside %s (line %d) -- it will render "
                    "invisible when that panel is hidden" % (oid, ", ".join(bad), self.getpos()[0]))

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                if i != len(self.stack) - 1:
                    unclosed = self.stack[i + 1]
                    self.errors.append(
                        "</%s> at line %d closes over unclosed <%s id=%s> opened at line %d"
                        % (tag, self.getpos()[0], unclosed[0], unclosed[1], unclosed[2]))
                del self.stack[i:]
                return
        self.errors.append("stray </%s> at line %d" % (tag, self.getpos()[0]))


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else 'finance-new.html'
    c = Checker()
    c.feed(io.open(path, encoding='utf-8').read())

    if c.stack:
        for t, i, ln in c.stack:
            c.errors.append("unclosed <%s id=%s> opened at line %d" % (t, i, ln))

    missing_overlays = REQUIRED_OVERLAYS - c.overlays
    if missing_overlays:
        c.errors.append("missing overlays: %s" % ", ".join(sorted(missing_overlays)))

    missing = EXPECTED_SECTIONS - set(c.sections)
    if missing:
        c.errors.append("missing sections: %s" % ", ".join(sorted(missing)))
    for sid, inside in sorted(c.sections.items()):
        if not inside:
            c.errors.append("section '%s' is OUTSIDE #sectionsList -- it cannot be reordered" % sid)

    if c.acct_in_list is None:
        c.errors.append("#acctGrid not found")
    elif c.acct_in_list:
        c.errors.append("#acctGrid is INSIDE #sectionsList -- balances must stay pinned")

    if c.errors:
        print("FAIL %s" % path)
        for e in c.errors:
            print("  - %s" % e)
        return 1

    print("OK %s -- %d sections, overlays at body level, balances pinned"
          % (path, len(c.sections)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
