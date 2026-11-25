# Lock the phone viewport and file Orders from OHL into the tab strip

**Status:** proposed  
**Date:** 2026-11-24

## Context

On a phone the campaign document was taller than the screen: the map kept a tall minimum and the aside demanded `28rem`, so the page scrolled. A finger on the map or an army chip then panned that page (and could pull-to-refresh) instead of drawing an order. Orders from OHL sat in a fixed strip under the header on small screens, apart from the Orders / Province / Chief of Staff tabs. Desktop already opened the same goal as a parchment paper from the document tray.

## Decision

`html` and `body` are `100dvh` with `overflow: hidden` and `overscroll-behavior: none`, and the campaign and teach shells pad for the safe area. The map and the army-chip layer use `touch-action: none`. Map pan and pinch stay enabled; they are suspended only while an arrow or a chip drag is in progress. Tab panels scroll inside themselves (`overflow-y: auto`, `overscroll-behavior: contain`).

Orders from OHL leaves the header strip. Below `lg` it is a phone-tray tab (`ohl-toggle`) with the same goal line. At `lg+` it stays the dismissible floating paper, opened from the same tray tab.

## Consequences

demo-check fits 390×844 and 360×740 and touch-drags a formation chip without moving the document. The start card uses auto margins: it stays centred when it fits, and when **More** briefing is taller than the phone the heading remains at the scroll origin. The desktop OHL paper and its tray-file check are unchanged. ADR 010 and ADR 012 still describe the desktop papers.
