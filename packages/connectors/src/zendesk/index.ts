export { createZendeskSpec } from './spec';
export type { ZendeskSpecOptions } from './spec';
export {
  iterateArticlesIncremental,
  fetchAllSections,
  fetchAllCategories,
  normalizeBaseUrl,
} from './api';
export type {
  ZendeskArticle,
  ZendeskSection,
  ZendeskCategory,
  ZendeskArticlesPage,
} from './types';
