import CompanionLLMService, { CompanionLLMService as CompanionLLMServiceClass } from '../services/CompanionLLMService.js';
import createAssistantRouter from '../routes/assistantRoutes.js';
import { createAssistantServiceApp } from '../service/createAssistantServiceApp.js';
import { LoraTrainingGateway } from '../training/LoraTrainingGateway.js';

export const API_VERSION = '1';

export function createCompanionLLMService(options = {}) {
  return new CompanionLLMServiceClass(options);
}

export {
  CompanionLLMService,
  CompanionLLMServiceClass,
  createAssistantRouter,
  createAssistantServiceApp,
  LoraTrainingGateway,
};
