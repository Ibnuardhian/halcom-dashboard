# Project pipeline: fields, stages and the sales-export mapping

Status: **implemented** for storage, import and display (D-019, D-020). Business rules marked *assumption* are not
confirmed. Source of truth in code: [pipeline.ts](../../src/domain/projects/pipeline.ts),
[fields.ts](../../src/domain/projects/fields.ts), [schema.prisma](../../prisma/schema.prisma).

## Stage and status

| Stage (where the deal is) | Status (is work live?) |
|---|---|
| New Opportunity, Assessment, Sizing / BOQ, POC, Quotation, Negotiation, Won, Lost | Active, On hold, Won, Lost, Completed, Closed |

They are stored separately. The export mixes them (a Won project can be *Won* or *Completed*), so neither is derived from the other.
Requests can be added only to a project whose **status is Active**.

## Metric definitions (used so far)

| Metric | Definition | Source |
|---|---|---|
| Weighted value | `estimated value × probability ÷ 100`. Empty when either is missing: a project with no estimate or no probability contributes nothing, never a guess. | `projects.estimated_value`, `projects.probability`; computed in `weightedValue()`, not stored |
| Open request | A request whose status is not Completed or Cancelled. | `requests.status` |
| Unassigned (open) | An open request with no assignee. | `requests.assignee_id` |
| Open / total requests (project list) | Count of the project's open requests / all its requests. | `requests` |

*Assumption:* amounts are plain numbers in IDR; no currency is stored (OPEN_QUESTIONS T-14). Further definitions
(sales target achievement, SLA health, progress) wait for OPEN_QUESTIONS T-16.

## Sales-export columns

| CSV column | Stored in | Notes |
|---|---|---|
| Project ID | `projects.code` | `PRJ-001`... must match `PRJ-` and 3 or more digits |
| Customer | `customers` (+ `projects.end_user_company`) | matched on a normalised name; the company text stays on the project for email subjects |
| Project Name, Project Description | `projects.name`, `description` | |
| Industry, Location | `projects.industry`, `location` | |
| Sales PIC | `projects.sales_owner_id` | one Sales account per name (required) |
| Technical PIC | `projects.technical_pic_id` | one SOA account per name |
| Principal | `principals` | brand; matched on a normalised name |
| Solution | `solution_categories` | |
| Estimated Value, Final Value | `estimated_value`, `final_value` | plain non-negative numbers |
| Probability | `probability` | whole number 0 to 100 |
| Target Closing, Won Date | `target_date`, `won_date` | `YYYY-MM-DD` |
| Stage, Status | `stage`, `status` | see above; unknown values reject the file |
| Competitor, Competition Status, Lost Reason, Lost Notes | same-named columns | |
| Requirement, Assessment Status, Solution Proposed, Architecture Status, Sizing Status, **BOM/BOQ Status**, Quotation Status, Proposal Status, POC Status, Technical Challenge, Technical Blocker, Technical Notes, Scope Estimate | technical columns | free text; a `BOM Status` heading is read as `BOQ Status` |
| Current Action, Next Action | first entries of the update feed (`project_actions`, no author) and `current_action`, `next_action` | line breaks are kept; later updates are posted in the application (D-020) |
| PIC / Stakeholder (raw) | `stakeholders` | free text (Halcom and customer people) |
| Weighted Value | not stored | recomputed from value and probability |
| Custom Fields (JSON) | `custom_fields` | must be valid JSON when present |

Updates and editing (D-020): current and next action are a comment-like feed written by SOA (when and by whom is the log; entries are never edited). SOA also changes the technical columns; each change is logged with from and to in `project_changes`.
