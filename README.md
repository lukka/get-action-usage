
- [**What is this?**](#what-is-this)
- [**Exploring the map**](#exploring-the-map)
- [**Usage trends**](#usage-trends)
- [**Developing the explorer**](#developing-the-explorer)
- [**The story behind: why?**](#the-story-behind-why)
- [**Challenges**](#challenges)
  - [**First version and its challenges**](#first-version-and-its-challenges)
  - [**Second solution and challenges**](#second-solution-and-challenges)
  - [**Further refinements**](#further-refinements)
- [**That's all!**](#thats-all)
- [**License Information**](#license-information)

## **What is this?**

[![Quick peek animation preview](https://raw.githubusercontent.com/lukka/lukka.github.io/main/images/get-action-usage-preview.gif)](https://lukka.github.io/graph/graph.html)

This repository contains the sources of the get-action-usage [GitHub Action](https://github.com/features/actions) that regularly builds and updates the [interactive graph](https://lukka.github.io/graph/graph.html) which visualizes the consumers of the following three other actions:
 * [run-cmake](https://github.com/lukka/run-cmake)
 * [get-cmake](https://github.com/lukka/get-cmake)
 * [run-vcpkg](https://github.com/lukka/run-vcpkg)

The action collects all usages in public GitHub repositories of the mentioned actions, the results are stored into the repository itself in the `action-usage-db.json` file, which is then consumed by the  [graph/graph.html](./graph/graph.html) page to visualize an interactive network graph. Eventually the files are [published online](http://lukka.github.io/graph/graph.html).


This `get-action-usage` is based on [NodeJS](https://nodejs.dev/) and it is running on a recurring [workflow](https://github.com/lukka/get-action-usage/blob/main/.github/workflows/run.yml).
The interactive map uses native Canvas and a data worker, with no external runtime dependencies.

<br>

## **Exploring the map**

The map opens automatically and shows public repositories using **run-cmake**, **get-cmake** and **run-vcpkg** in one central cloud. The action hubs anchor a triangle: **get-cmake** at the upper left, **run-vcpkg** at the upper right, and **run-cmake** below. Center attraction draws matching repositories toward the triangle's centroid, with collision constraints keeping circles apart. Repository circle colors and diameters identify star buckets: **bronze (25-99)**, **silver (100-999)**, and **gold (1,000+)**, with relative diameters of **1 : 1.5 : 2**. Counts below 25 use a neutral circle at the bronze diameter. Action hubs and relationship lines retain their own action colors.

Matching repositories settle together in the central area of the triangle, rather than in separate rectangular action groups. The triangle reserves only the clearance needed for its hubs and labels, rather than oversized proportional side margins. Tighter packing and a shared size scale reclaim room for sparse filters and larger viewports without overlapping circles or action hubs. There is no fixed minimum circle size: zoom scales every diameter proportionally. Normal, nearby, and active previews each apply the same bucket weights and fill colors, including during their transitions.

Circle contents adapt to their on-screen size: small circles retain solid bucket colors, medium circles show a count and colored Unicode star, and circles with at least a 26 px radius include the owner and repository name. Zoom controls both circle and content size. Names use the actual glyph bounds and available circular width of each row, with short names enlarged when row height permits. Long names show the longest fitting prefix followed by the single ellipsis character, rather than wasting room on padding or three separate periods. Full names remain available in the inspector and tooltip. Underlined repository names are native links that open GitHub code search in a new tab, scoped to that repository and matching `get-cmake OR run-cmake OR run-vcpkg` across its source files. Keyboard activation, middle/modifier clicks, and copying the link work normally; dragging a name moves its node without opening a search. Click elsewhere inside the circle to pin its details. Narrow circles use compact counts; expanded circles show the full count when it fits. Previews and tooltips stay clear of enlarged neighbors, action hubs, and their labels.

* Search by owner, repository name, description, or language. Multiple words must all match.
* Set an inclusive minimum/maximum star range, or use the quick minimum-star presets. These filters operate on the recorded database, not all of GitHub; the collector currently searches for projects with at least 25 stars.
* Select actions and choose **any** (union) or **all** (intersection). Choose an action version to narrow the results further. Version-option counts reflect the other filters, so alternative versions remain discoverable.
* Click or tap a circle body or list entry to expand a repository and pin its details. Expansion is explicit and persistent: moving across another circle, a name link, a list row, an action hub, or outside the map never changes the expanded repository or repacks its neighbors. Hover and keyboard focus only preview details and highlight existing geometry. Select another circle body or list entry to switch; click/tap empty space, close or unpin details, or press Escape to collapse. On touch screens, a tap selects directly without any hover or double-tap requirement, and details open in a dismissible bottom sheet. Dragging and pinching never select or open a link.
* While a repository is expanded, the closest visible repository, measured from the mouse pointer to its painted circle edge, becomes brighter with a light outline and a short diameter pulse. Mouse movement direction does not affect the choice. A temporal low-pass filter waits for a new target to remain more than 4 px closer for 180 ms before switching, keeping the previous highlight during that interval. Initial highlighting also waits for a stable target. Near-ties and brief reversals do not flicker or restart the pulse. This is only a visual cue: it never changes the expansion, circle positions, diameters, or hit areas. Context dots behind the expansion fade before contact and return afterward, retaining their original geometry.
* Circles ease in and out over 240 ms, measured from the first painted frame so setup work cannot consume the transition. Click/tap handoffs and reversals continue from painted geometry, which controls hit testing; hidden context dots cannot intercept clicks. A newly accepted proximity target pulses for 700 ms, then keeps its static highlight without idle repainting. Linked action hubs keep showing the selected project's versions (with `+N` for additional versions), and the inspector lists every version in full. Reduced-motion preferences disable transitions and the proximity pulse, but retain the filtered static highlight, including live preference changes. Touch selection expands the chosen circle without the mouse-only nearby enlargement or proximity cues. Use version buttons to filter and expand **view source** to open exact workflow lines.
* All three action hubs stay at their triangle vertices and remain clickable while panning or zooming. Click a hub to filter its projects; click it again to remove that single-action filter. Drag dots to rearrange them, drag the background to pan, scroll/pinch to zoom, or use **Fit view**. Filters and viewport resizing settle matching projects back into the central cloud and reclaim unused space; sorting the list alone preserves the layout, camera, and dragged positions. On small screens, pinning a project shortens the map so the entire triangle remains above the details sheet.
* Browse all matching projects using the paginated, sortable list. Only 40 rows are rendered at once, independently of the size of the database.
* Switch between **Repository map** and **Usage trends** without leaving the page. Only the selected view is visible; switching back preserves map filters, the pinned project, and the camera. The hidden map does not animate.
* **Copy view link** shares the selected view, trend metric, map filters and pinned project. The URL also restores that view on reload, and the view tabs support browser Back/Forward. Press `/` to search, Tab/Enter to select list entries, and Escape to clear a selection. The focused map supports arrow-key panning, `+`/`-` zoom, and `0` to fit.

Project counts are **distinct repositories**, not workflow occurrences. A project can appear under multiple actions or versions. Workflow-usage counts represent recorded action occurrences; stars and workflow links reflect the last scan, not live GitHub data. Loading failures and incomplete records are reported explicitly.

Workflow source links use GitHub's canonical file URL with the recorded line anchor. Branch names containing hyphens, dots or slashes and legitimate filename suffixes are preserved, rather than reconstructed from an API URL or replaced with today's default branch.

## **Usage trends**

The **Usage trends** tab shows a separate time-series chart for **get-cmake**, **run-cmake** and **run-vcpkg**. Choose **Distinct repositories** (the default) or **Workflow usages**. Charts share a zero-based vertical scale and use actual UTC snapshot times on the horizontal axis. Hover to inspect a point, or focus a chart and use Left/Right, Home/End. Each chart has an expandable data table. A single observation is shown as a point, not an invented trend; empty, incomplete and unavailable history are reported explicitly.

History is reconstructed from saved database revisions, starting in June 2022: the first available observation and the last saved database in each UTC week. Future successful collector runs append a timestamped snapshot, even if the counts stay unchanged. `graph/usage-history.json` stores versioned, compact per-action repository and workflow counts, source commit IDs for backfilled points, and incomplete-record counts. It loads only when opening the trends view; a direct `?view=trends` link does not download the full repository database.

**These are recorded database counts, not action execution counts or exact adoption dates.** The collector scans incrementally, is API-limited, and currently searches non-fork C++ repositories with at least 25 stars. Saved databases combine observations from different scan times, so growth can reflect discovery and refresh progress rather than new adoption. The scan cursor and repository creation/update dates are not used as observation dates. Map filters do not apply to historical totals.

## **Developing the explorer**

```sh
npm ci
npm run build:graph
python3 -m http.server 8080 --bind 127.0.0.1
```

Open `http://127.0.0.1:8080/graph/graph.html`. All assets, `action-usage-db.json` and `usage-history.json` load from the same directory; no CDN or remote production database is required.

To rebuild historical observations from a full (not shallow) Git checkout, or record the current database after a scan:

```sh
npm run history:backfill
npm run history:record
```

Backfilling is idempotent and preserves previously recorded collector-run observations. Recording uses the same normalization and occurrence deduplication as the map. Invalid existing history fails without overwriting it. The scheduled publication workflow records a snapshot after collection, commits both data files, and publishes them with the explorer assets.

Frontend TypeScript lives in `web/`; commit its compiled `graph/*.js` files alongside source changes. The HTML and CSS are in `graph/`. The worker parses, normalizes, filters, and lays out matching projects off the main thread. Deterministic bucket-sized rings seed a bounded center-attraction settle; spatially indexed swept collision constraints prevent overlaps throughout settling. A common scale fits the resulting cloud into the triangle's centroid-centered inellipse, preserving bucket diameter ratios. Layouts are reused when only result order or facets change. Spatial indexes handle pointer hit testing, and separate canvas layers keep hover updates from repainting the base scene.

A neighborhood is chosen from the native spatial index on explicit selection and cached until selection, data, or camera geometry changes. Hover and list focus never invalidate this geometry or override a selected repository. Bounded nearest insertion considers at most six neighbors on wide maps, fewer on narrow maps. Feasible circle contacts, intersections, and viewport edges provide readable, compact placement without a global hover simulation. The proximity cue ranks visible painted circles by pointer-to-edge distance, excluding the selected repository and hidden or off-screen circles. A 4 px hysteresis margin and a 180 ms challenger dwell form a temporal low-pass filter on target changes. Ties are deterministic; a changed or canceled challenger restarts the interval, without restarting the current target's pulse. Pending cues are reevaluated in finite animation frames, so they settle even after the pointer stops, including with reduced motion. Selection changes, pointer exit, list previews, action hover, gestures, and data/camera changes discard stale cue state without collapsing the selection. Brightening and the pulsing outline are overlay-only decorations; neither layout nor hit testing uses the pulse radius. Touch does not create mouse neighborhoods or proximity cues.

Other visible dots retain their native geometry and fade before contact, so previews cannot overlap them or cause a full-graph repack. Fade checks skip already hidden dots and use squared-distance bounds to avoid unnecessary distance calculations and allocations. The overlay reuses owned frame geometry without mutating interpolation endpoints, and batches tiny context dots by bucket color and opacity. Hit tests use painted geometry and exclude hidden dots; tooltips avoid readable circles. Repository-name anchors reuse those painted glyph bounds, including fitted prefixes and interpolated positions. Only visible, unobscured names have links; anchors keep their identity while visible, share pointer/zoom handling with the canvas, and are hidden with the map. Animation frames run only during finite transitions, pending proximity selection, or a new target's short cue pulse, then stop. Reduced motion skips visual transitions and pulses, not the target-change filter. There is no continuous animation loop.

```sh
npm run build:graph
npm test -- --runInBand
npx playwright install chromium
npm run test:browser
```

Browser tests cover filters, exact workflow navigation, mouse/keyboard/touch gestures, failure recovery, responsive layout, usage-history charts and exclusive view navigation, and a 10,000-project dataset. The existing `npm run pack` also builds the explorer; CI checks that generated assets stay synchronized. The scheduled/manual publication workflow runs only on the default branch and copies **all** explorer assets, the database and usage history to the website; pull requests do not publish unmerged changes. Its default GitHub token has read-only contents access; the existing PAT supplies collection and publication access.

## **The story behind: why?**

In early 2020 I released the GitHub Actions for using [CMake](https://cmake.org/) and [vcpkg](https://vcpkg.io/) on GitHub:
 * [run-cmake](https://github.com/lukka/run-cmake)
 * [get-cmake](https://github.com/lukka/get-cmake)
 * [run-vcpkg](https://github.com/lukka/run-vcpkg)

Later in 2022 I was thinking if those actions are useful at all: _"are being used? If so who?"_.

Naturally I thought that it was obvious I could satisfy my curiosity by writing another software that would tell me the answer by visualizing it somehow.

<br>

This is the way I thought I'd like to collect all the occurrences of those actions in GitHub workflows, and then somehow visualize them in a graph.

<br>

Since my initial choice has been to not implement anything unpleasant in the actions like `telemetry` (aka remote monitoring), one alternative way to get all their usage is to scan all the public GitHub repository and look in their workflow files (stored under `/.github/workflows/` directory). Executing this manually would be not possible, it must be automatized.

<br>

Initially I wrote a `Node.js` application in `JavaScript` that, using the [@octokit](https://github.com/octokit) module, is leveraging underneath the `GitHub HTTP APIs` to fetch the data. The program would first get the list of repositories and then look for the usage of the actions in their workflow.

This naive idea presented several challenges.

<br>

## **Challenges**

Obtaining the answer to my curiosity was hard and presented several challenges to face, think about and overcome, which I roughly group in three main set of challenges that were solved in three subsequent implementations.

### **First version and its challenges**

The initial program looked like this:

```js
import { Octokit } from '@octokit/rest';

search() {
  const repos = octokit.rest.search.repos("language=cpp desc sort=stars");
  foreach(var repo in repos) { 
    //... look in `.github/workflow` for occurrences of 'run-cmake' or 'run-vcpkg' ...
    await this.octokit.rest.repos.getContent(...)
  }
}
```

This code surfaced some problems:

 1. The `search domain` (i.e. list of repositories) is far bigger than the maximum limit of `1,000` results per search provided by the [Search APIs](https://docs.github.com/en/rest/search).
 2. The list of repositories is also very long, attention to the secondary HTTP request limit forces to honor the [Retry-After](https://docs.github.com/en/rest/guides/best-practices-for-integrators#dealing-with-secondary-rate-limits) header when doing lot of queries for long time.

<br>

Here my attempted solutions:

1. To overcome the point one, the `search domain` has been partitioned in several periods of time, hoping that the resulting list is never more than `1,000` hits. This is a simple solution that could be improved by re-trying with a smaller period of time when the limit is hit.
2. For point two, I just added a simple sleep of three seconds for each HTTP request.

This is pseudo code of the next attempted solution:

```js
import { Octokit } from '@octokit/rest';

search() {
  foreach(var timePeriod in timePeriods) { 
    const repos = octokit.rest.search.repos(`language=cpp desc sort=stars created=${timePeriod.begin}..${timePeriod.end}`);

    foreach(var repo in repos) { 
      //... look in `.github/workflow` for occurrences of 'run-cmake' or 'run-vcpkg' ...
      await delay(3000);
      await this.octokit.rest.repos.getContent(...)
    }
  }
}
```

This allowed to get something like thousands of repositories scanned over an hour, and the repositories to look into are way more than that.

Now I thought that either I keep running this program locally on my computer for a very long time, or I could let it running as a GitHub Action itself and schedule a recurring run, and so I did. 

<br>

### **Second solution and challenges**

To regularly scan and collect the data incrementtally a workflow has been created with a single job in it.

Running on [GitHub hosted runners](https://docs.github.com/en/actions/using-github-hosted-runners/about-github-hosted-runners) is good but with caveats:

1. Using `GITHUB_TOKEN` has a [limit of 1000 requests per hour](https://docs.github.com/en/rest/overview/resources-in-the-rest-api#requests-from-github-actions), instead a personal access token must be used to maintain the mentioned limit of `5000` requests/hour. So the latter must be preferred.
2. The workflow job can run for at most **6** hours, then it is going to be ungracefully cancelled without any chance to save any completd work. That is NOT enough time to get the full results. In fact the result must be incrementaly computed, and
I had to instrument the application to accumulate the results among multiple runs. This has been accomplished accumulating results to a simple database implemented with the [node-json-db](https://www.npmjs.com/package/node-json-db) module. In the same way a marker is written in the file that identify which is the next date to start the search from.

This is roughly how the second implementation looked like:

```js
import { Octokit } from '@octokit/rest';
import { JsonDB } from 'node-json-db';

search() {
  foreach(var timePeriod in timePeriods) {
    const repos = octokit.rest.search.repos(`language=cpp desc sort=stars created=${timePeriod.begin}..${timePeriod.end}`);
    
    foreach(var repo in repos) { 
      //... look in `.github/workflow` for occurrences of 'run-cmake' or 'run-vcpkg' ...
      await delay(3000);
      await this.octokit.rest.repos.getContent(...);
    }
  }
  this.db.save(true);
} 
```

Now as noted by the astute reader, for incrementality to work correctly we need to store the JSON file somewhere to be later retrieved. I decided to push it in the repository itself, and doing this is easy when using the [@action/checkout](https://github.com/actions/checkout) action, which allows the workflow to easily [push data to the just cloned repository by using the PAT](https://github.com/lukka/get-action-usage/blob/main/.github/workflows/run.yml#L42).

Also, the workflow needs to be scheduled for re-running as soon as possible. The solution is to:
 - run it regularly with a fixed schedule (e.g., every hour).
 - and schedule the next re-run based on when the API rate limit are reset, that is ASAP.
 
 On each run, either the database JSON is filled with new data, and the workflow is _patched_ to schedule a next run when the API HTTP request quota is given back. Both changes are pushed onto the repository by the workflow itself, as follows:

workflow:
```yaml
on:
  pull_request:
  schedule:
    - cron: '0 * * * *' # Regular run each hour.
    - cron: '1 2 3 4 5' # Scheduled re-run as soon as the rate limit are reset and full quota is got back.

[...]

- name: Commit DB content and update CRON job
  run: |
     ...
     git remote set-url origin https://x-access-token:${{ secrets.PAT }}@github.com/${{ github.repository }}
     ...
     git push
```

Again, challenges of the solution:

1. Since the workflow is **self modifying**, the [`PAT` needs to be setup](https://docs.github.com/en/actions/security-guides/automatic-token-authentication#granting-additional-permissions) such it has the 'workflow' permission that grants to "Update GitHub Action workflows". The ordinary `GITHUB_TOKEN` does not have that permission.

2. It is likely to happen that two workflows run concurrently. In this case, it's best to ensure only one is actually querying by checking whether there is an already running workflow at the very start and exit immediately without further action in affirmative case.

3. Whenever the second scheduled workflow fails before having the chance to schedule the next run, the first hourly schedule is going to (hopefully) fix it.

<br>

### **Further refinements**

The fixed delay for each HTTP request is not really necessary, and it does not play nice with concurrent requests, which would improve a lot the results' throughput. 

The solution is to leverage the following NPM libraries that respect the secondary limits and permit maximum speed:

In file `packages.json`:
```
  "dependencies": {
    "@octokit/plugin-rest-endpoint-methods": "^5.13.0",
    "@octokit/plugin-retry": "~3.0.9",
    "@octokit/plugin-throttling": "^3.6.2",
  }
```

The package [@octokit](https://github.com/octokit/plugin-throttling.js/) and the others allow to drop the silly fixed delay time and to run concurrently several requests searching for occurrences of the actions, by improving performance `100x`. 

```js
import { Octokit } from '@octokit/rest';
import { JsonDB } from 'node-json-db';
import { throttling } from '@octokit/plugin-throttling';
import { retry } from '@octokit/plugin-retry';
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods';

search() {
  foreach(var timePeriod in timePeriods) {
    const repos = octokit.rest.search.repos(`language=cpp desc sort=stars created=${timePeriod.begin}..${timePeriod.end}`);
    
    foreach(var repo in repos) { 
      // ... look concurrently in `.github/workflow` for occurrences of 'run-cmake' or 'run-vcpkg' ...
      const promise = this.octokit.rest.repos.getContent(...)
      // ...
      await Promise.all(promises);
    }
  }
}
```

## **That's all!**

Feedback is welcome, create [Issues](https://github.com/lukka/get-action-usage/issues) entries, pretty sure this is not the end of the story!

## **License Information**

Copyright 2022-2023-2024-2025 by Luca Cappa lcappa@gmail.com
All content of this repository is licensed under the CC BY-SA License. See the LICENSE file in the root for license information.