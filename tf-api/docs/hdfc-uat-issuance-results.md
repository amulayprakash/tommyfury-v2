# HDFC ERGO — live UAT issuance evidence

Generated 2026-08-13T06:25:18.238Z by `npm run hdfc:issue` (`scripts/hdfc-uat-issuance.ts`). Every row below was fired at **live HDFC UAT** through the production provider, and every policy number is a **real bound UAT policy**.

| # | Scenario | Proves | Reached | Proposal no. | Gross | Policy no. | HDFC's message |
| ---: | --- | --- | --- | --- | ---: | --- | --- |
| 1 | Roll Over 1+1 comprehensive, no add-ons | the baseline package policy | done | 202608130000197 | ₹5,715 | 2302201225648600000 | — |
| 2 | Roll Over 1+1 comprehensive, all covers | add-ons survive to issuance | done | 202608130000199 | ₹14,162 | 2302201225648700000 | — |
| 3 | New Business 1+3 comprehensive | the statutory 3-year TP leg | done | 202608130000205 | ₹22,714 | 2302201225648800000 | — |
| 4 | Standalone OD 0+1 | the OD-only product | done | 202608130000207 | ₹1,300 | 2302201225648900000 | — |
| 5 | Liability 0+1 (TP only) | the liability product | done | 202608130000212 | ₹4,414 | 2302201225649000000 | — |
| 6 | Roll Over 1+1 with a >24h break-in | inspection routing at proposal time | proposal | — | — | — | `HDFC createProposal failed: Break-in ID required` |
