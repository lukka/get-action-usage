import { filterRepositories, layoutRepositories, normalizeDatabase, } from './model.js';
let repositories = [];
let layout = null;
let layoutIds = new Set();
let circles = [];
function respond(message) {
    self.postMessage(message);
}
self.onmessage = async (event) => {
    try {
        if (event.data.type === 'load') {
            const response = await fetch(new URL('./action-usage-db.json', import.meta.url), { cache: 'no-cache' });
            if (!response.ok) {
                throw new Error(`The database request failed (HTTP ${response.status}).`);
            }
            const database = await response.json();
            const normalized = normalizeDatabase(database);
            repositories = normalized.repositories;
            layout = null;
            layoutIds.clear();
            circles = [];
            respond({ type: 'loaded', ...normalized });
        }
        else {
            const result = filterRepositories(repositories, event.data.filters);
            const ids = new Set(result.ids);
            const viewport = event.data.viewport;
            if (!layout ||
                layout.width !== viewport.width ||
                layout.height !== viewport.height ||
                ids.size !== layoutIds.size ||
                result.ids.some(id => !layoutIds.has(id))) {
                const visible = repositories.filter(repository => ids.has(repository.id));
                layout = layoutRepositories(visible, viewport);
                layoutIds = ids;
                circles = visible.map(({ id, x, y, radius }) => ({ id, x, y, radius }));
            }
            respond({
                type: 'filtered',
                requestId: event.data.requestId,
                result,
                layout,
                circles,
            });
        }
    }
    catch (error) {
        respond({
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
        });
    }
};
