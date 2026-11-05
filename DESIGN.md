# DESIGN.md

Design direction for Halcom Dashboard, written down as the antislop rules ask (R-31, R-37). Each decision has one line of reason. A decision whose reason stops being true should be changed, not defended.

Reading this as: an internal work tool for Sales, SOA, Purchasing, Finance and administrators who open it many times a day, in a plain, dense, table-first style.

Dial: ENERGY 1 / RHYTHM 1 / MOTION 1

- ENERGY 1: people come here to find a request and act on it, so the interface should not compete with the data.
- RHYTHM 1: pages share one structure (header, tiles, charts, tables) on purpose, so a person who knows one dashboard knows them all.
- MOTION 1: hover and focus states only. No page-load animation.

## Decisions

| Area | Decision | Reason |
|---|---|---|
| Primary color | `#1173BA`, from the Halcom logo | It is the brand color, and white text on it measures 5.0:1. |
| Warning color | Amber `#F59E0B`, for attention states only | A second color carries meaning (something needs a look), so it is never decoration. |
| Chart colors | Fixed series `--viz-1` to `--viz-8`, then grey for "Not set" and "Other" | Slices keep the same color for the same rank, and grey marks the rows that are not a real category. |
| Theme | Light and dark, switchable | People work in it for long stretches, and a working light/dark switch lets them choose (R-21). |
| Typeface | Geist (sans) | No brand typeface was supplied. Geist stays because it is legible at small sizes in tables, and the money columns use `tabular-nums` so digits line up. Replace it if Halcom provides a brand font. |
| Mono | Geist Mono, for codes and technical values | Codes and technical values line up in columns. |
| Radius | One scale from `--radius` (0.625rem) | Cards, inputs and dialogs share it. `rounded-full` is rare and never used on buttons or cards. |
| Shadow | Dialogs, dropdowns and the mobile sidebar only | Shadow marks what sits above the page. Cards are separated by a ring, not a shadow. |
| Blur | The sticky header only | It keeps the table visible behind the header while scrolling. |
| Icons | Lucide, one icon per menu page, no decorative icons | The set is the shadcn default and already in the project. Each menu icon names the page's job (timer for SLA, scale for crosscheck, library for master data), and no two pages share one. |
| Labels | Sentence case, 12px minimum, no uppercase tracking | Uppercase labels are harder to scan in a long list of tiles and legends. |
| Background | Plain; the sign-in pages have a faint blue tint at the top | The tint is the accent color at low strength and ties the two pages outside the shell to the brand. It is the only gradient. |
| Charts | Bars and donuts rank largest first, with "Not set" and "Other" last. Funnel and stage columns keep pipeline order | Ranking answers "who or what has the most". Stages are a sequence, so their order is the information. |
| Language | Labels, titles and buttons in English; sentences, hints, empty states and placeholders in Indonesian | The team names its screens in English (BOQ, RFQ, PO, SLA) and reads explanations in Indonesian. |
| Placeholder text | One color everywhere: the text color at 50% (the Tailwind default) | Example text must look different from typed text. Input, textarea and the search boxes used two different greys before. |
| Excel on Projects | One "Import projects" button and one dialog with three numbered steps: download a template, fill it in, upload it. The template menu in step 1 offers a blank template (add projects) and the current projects (update them); step 3 has one upload | Adding and updating share the same upload, so they share the dialog. They differ only in the file the person starts from, so that is where the choice sits (the pattern of accounting-software import dialogs). Update appears only for people who may bulk update. |
| Location chart | "Customers by location" as a ranked bar list, not a map. A customer is counted once, under the location most of its projects name | Locations are free text typed on projects, with no coordinates, so a map would show positions the system does not hold. Counting customers (not projects) answers "where are our end users"; a customer with projects in two places would otherwise count twice. Each bar opens the Customers list for that location. |
| Copy | Short, positive, no claims the page cannot check | A page that says "your data is safe" must be able to know that. |

## Not used, on purpose

Glow, glassmorphism on cards, bento grids, hero sections, animated counters, sparkle icons, "AI powered" badges, fake statistics, testimonials.

## Sales targets page (gross profit, per quarter)

Reading this as: a quarterly gross-profit scorecard for Sales (their own year) and management (the whole team), same dials as the rest of the app (ENERGY 1 / RHYTHM 1), except MOTION 2 on this one page for the year change.

| Area | Decision | Reason |
|---|---|---|
| Focal point | One panel: Won GP (estimated) as the largest number, a single progress bar, then the annual target, remaining and open pipeline as a plain list | The page answers "how far are we from the target"; one number leads and the others support it, so there are no four identical tiles. |
| Open pipeline GP | Listed apart, labeled as potential, never added to Won GP, no probability applied | Potential is not performance; mixing them would overstate achievement. |
| Won GP label | "Won GP (estimated)" | There is no stored actual margin: the figure is project value times the target margin, so it is not called actual. |
| Charts | Target is an outlined bar and a dashed line; achieved is a solid bar and a solid line (`--viz-1`); a red triangle marks a quarter that ended below target | Series differ by shape as well as colour. Red is used only for "behind target". |
| Missing target | A quarter with no target shows no target bar and says "Not set"; zero is a thin line. The target line is drawn only when some quarter has a target and is never spread evenly by the page | Not set and zero are different facts; inventing a target would be a fabricated number (R-17). |
| Year slider | Previous and next, the neighbouring years, the selected year in the primary colour with "this year / past / upcoming", and a list for direct choice | The years offered come from the data (targets, won dates) plus this year and next, not a fixed range. |
| Motion | The content slides in 300 ms from the side the year lies on; the old content dims while loading; switched off under reduced motion | It shows which way in time the person moved, and it is the only motion on the page. |
| Table | Quarterly figures and the team table are plain tables; the figures behind each chart are also in a table | Exact numbers and a text alternative for the charts. |

Not used on this page, on purpose: gradients, glow, animated counters, a revenue tile.
