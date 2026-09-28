/**
 * @fileoverview src/lib/integration/bootstrap.ts.
 *
 * Reviewer notes:
 * - See docs/code-walkthrough-review.md for the project map, review priorities,
 *   and commenting standard that applies to this module.
 */
import { AIService } from '../ai/types';
import { configureAIService } from '../ai/service';
import { AssetService, configureAssetService } from './assetService';
import {
  configureInstitutionRepositories,
  InstitutionRepositoryOptions,
} from './InstitutionRepositoryFactory';
import {
  configureInstitutionSnapshotCache,
  InstitutionSnapshotCache,
} from './institutionSync';
import {
  configureLearningStateService,
  LearningActivityConsent,
  LearningStateScope,
  LearningStateService,
} from '../learningState';

export interface InstitutionLMSConfiguration {
  repositories: InstitutionRepositoryOptions;
  assetService: AssetService;
  aiService: AIService;
  /** Required for durable principal/course/content-scoped resume state. */
  learningStateService?: LearningStateService;
  /** Omit to keep the separate learning-activity/analytics channel disabled. */
  learningActivityConsent?: (scope: LearningStateScope) => Promise<LearningActivityConsent>;
  /** Must be encrypted and bound to the device credential boundary. */
  snapshotCache?: InstitutionSnapshotCache;
}

/**
 * Configures every production trust boundary from one institution-owned entry
 * point. Construct and validate remote service URLs before calling this during
 * app bootstrap, before authenticated routes are rendered.
 */
export const configureInstitutionLMS = (configuration: InstitutionLMSConfiguration) => {
  if (!configuration || !configuration.repositories || !configuration.assetService || !configuration.aiService) {
    throw new Error('Institution LMS configuration requires repositories, asset storage, and AI services.');
  }
  const adapterLearningState = configuration.repositories.adapter as Partial<LearningStateService>;
  const learningStateService = configuration.learningStateService
    ?? (adapterLearningState.load && adapterLearningState.save && adapterLearningState.remove
      ? adapterLearningState as LearningStateService
      : null);
  if (!learningStateService) {
    throw new Error('Institution LMS configuration requires a durable learning-state service. Custom gateways must supply learningStateService.');
  }
  const repositories = configureInstitutionRepositories(configuration.repositories);
  configureAssetService(configuration.assetService);
  configureAIService(configuration.aiService);
  configureLearningStateService(learningStateService, configuration.learningActivityConsent);
  configureInstitutionSnapshotCache(configuration.snapshotCache ?? null);
  return repositories;
};
