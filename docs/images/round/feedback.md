# Redline feedback: round 1

- Channel: `brave-lovebird`
- Session: `763500b5-2c53-4f6c-b26c-06e99b36cf14`
- Status: **feedback**. Apply it, reload the page, and wait for the next round.
- Snapshots: 1, annotations: 3

## S1: Kestrel: pricing

- URL: http://127.0.0.1:42609/
- Screenshot: `S1.annotated.png` (without the annotations: `S1.clean.png`)
- Viewport: 1120×760 CSS px, dpr 2, scrolled to (0, 0)
- Common path of its marks: `section.plans > article.plan.featured[2/3]`

- **#1** rectangle at (433, 546), 130×54 on `article.plan.featured > button` "Start free trial"
  - Path: `… > button`

  > Make this the main call to action: filled, full width

- **#2** arrow from (675, 275) pointing at (549, 350) on `article.plan.featured > p.price` "$24 / month"
  - Path: `… > p.price[1/2]`

  > Prices should be the biggest thing on the cards

- **#3** freehand mark at (428, 359), 124×34 on `article.plan.featured > p.billing` "Billed anually"
  - Path: `… > p.billing[2/2]`

  > Typo: annually

---

Coordinates are CSS pixels of the screenshot, from its top left corner; a screenshot pixel is `dpr` times smaller.
Each `#id` is drawn next to its mark on the annotated screenshot, and is the same mark in every snapshot of the session. The selector is the element under the mark's center, or under an arrow's tip.
