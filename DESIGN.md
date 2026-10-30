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
| Location chart | A ranked bar list ("Projects by location"), not a map | The location is free text typed per project (a city, a site), with no coordinates. A map would need guessed positions, so it would show data the system does not hold. Bars rank by number of projects and each one opens the Projects list for that location. |
| Copy | Short, positive, no claims the page cannot check | A page that says "your data is safe" must be able to know that. |

## Not used, on purpose

Glow, glassmorphism on cards, bento grids, hero sections, animated counters, sparkle icons, "AI powered" badges, fake statistics, testimonials.
