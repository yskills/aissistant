class PromptBuilder {
  constructor({
    normalizeMode,
    getModeConfig,
    loadModeConfig,
    summaryContextWindow = 4,
  } = {}) {
    this.normalizeMode = normalizeMode;
    this.getModeConfig = getModeConfig;
    this.loadModeConfig = loadModeConfig;
    this.summaryContextWindow = summaryContextWindow;
  }

  renderTemplateString(value, context = {}) {
    let output = value;
    Object.keys(context).forEach((key) => {
      output = output.replaceAll(`{{${key}}}`, context[key]);
    });
    return output;
  }

  mergeUnique(a = [], b = []) {
    return [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])];
  }

  resolveModeMemory(user = {}, activeMode = 'normal') {
    const modeMemory = user?.profile?.modeMemory || {};
    const normalModeMemory = modeMemory.normal || {};
    const uncensoredModeMemory = modeMemory.uncensored || {};
    const activeModeMemory = activeMode === 'uncensored' ? uncensoredModeMemory : normalModeMemory;

    const learnedPinnedMemories = activeMode === 'uncensored'
      ? this.mergeUnique(normalModeMemory.pinnedMemories || [], uncensoredModeMemory.pinnedMemories || [])
      : (Array.isArray(activeModeMemory.pinnedMemories) ? activeModeMemory.pinnedMemories : (user?.profile?.pinnedMemories || []));

    const learnedGoals = activeMode === 'uncensored'
      ? this.mergeUnique(normalModeMemory.goals || [], uncensoredModeMemory.goals || [])
      : (Array.isArray(activeModeMemory.goals) ? activeModeMemory.goals : (user?.profile?.goals || []));

    const learnedNotes = activeMode === 'uncensored'
      ? this.mergeUnique(normalModeMemory.notes || [], uncensoredModeMemory.notes || [])
      : (Array.isArray(activeModeMemory.notes) ? activeModeMemory.notes : (user?.profile?.notes || []));

    return {
      learnedPinnedMemories,
      learnedGoals,
      learnedNotes,
    };
  }

  resolveCharacterConfig(modeConfigFromFile = {}, modeConfig = {}) {
    const characterDefinition = modeConfig?.characterDefinition?.definition || {};
    return {
      characterDefinition,
      assistantProfile: characterDefinition.assistantProfile || modeConfigFromFile.assistantProfile || {},
      characterBlueprint: characterDefinition.characterBlueprint || modeConfigFromFile.characterBlueprint || {},
      consistencyProfile: characterDefinition.consistencyProfile || modeConfigFromFile.consistencyProfile || {},
      modeProfiles: characterDefinition.modeProfiles || modeConfigFromFile.modeProfiles || {},
      promptDefinitions: characterDefinition.promptDefinitions || modeConfigFromFile.promptDefinitions || {},
    };
  }

  buildSummaries(user = {}, modeUsesChatMemory = false) {
    const source = modeUsesChatMemory
      ? [...(user.summaries || []), ...(user.uncensoredSummaries || [])]
      : [...(user.summaries || [])];
    return source
      .slice(-this.summaryContextWindow)
      .map((summary) => `[${summary.reason}] ${summary.summary}`)
      .join(' | ');
  }

  buildSystemPrompt(user, mode = 'normal') {
    const activeMode = this.normalizeMode(mode || user?.profile?.mode);
    const modeUsesChatMemory = activeMode === 'uncensored';
    const memoryScopeLabel = activeMode === 'uncensored' ? 'normal+uncensored read access' : 'active mode only';
    const modeConfigFromFile = this.loadModeConfig();
    const modeConfig = this.getModeConfig(activeMode, modeConfigFromFile, user?.profile?.characterId);
    const name = user.profile.preferredName || 'Trader';
    const {
      assistantProfile,
      characterBlueprint,
      consistencyProfile,
      modeProfiles,
      promptDefinitions,
    } = this.resolveCharacterConfig(modeConfigFromFile, modeConfig);
    const configUserProfile = modeConfigFromFile.userProfile || {};
    const memoryProfile = modeConfigFromFile.memoryProfile || {};
    const activeModeProfile = activeMode === 'uncensored'
      ? (modeProfiles.uncensored || {})
      : (modeProfiles.normal || {});
    const modeExtras = user?.profile?.modeExtras || {};
    const { learnedPinnedMemories, learnedGoals, learnedNotes } = this.resolveModeMemory(user, activeMode);
    const fileUncensoredInstructions = modeConfigFromFile?.uncensored?.instructions || [];
    const fileUncensoredMemories = modeConfigFromFile?.uncensored?.memories || [];
    const profileUncensoredInstructions = (modeExtras.uncensoredInstructions || []).slice(-20);
    const profileUncensoredMemories = (modeExtras.uncensoredMemories || []).slice(-40);
    const extraInstructions = [...fileUncensoredInstructions, ...profileUncensoredInstructions];
    const extraMemories = [...fileUncensoredMemories, ...profileUncensoredMemories];
    const modeDefinition = activeMode === 'uncensored'
      ? [...(promptDefinitions.normal || []), ...(promptDefinitions.uncensored || [])]
      : (promptDefinitions.normal || []);
    const summaries = this.buildSummaries(user, modeUsesChatMemory);
    const recentAssistantLine = modeUsesChatMemory
      ? String(user?.uncensoredHistory?.slice(-1)?.[0]?.assistant || user?.history?.slice(-1)?.[0]?.assistant || '').trim()
      : String(user?.history?.slice(-1)?.[0]?.assistant || '').trim();

    return [
      `Assistant name: ${modeConfig.character}.`,
      `Reply language: ${modeConfig.language}.`,
      `Assistant profile name: ${assistantProfile.name || modeConfig.character}.`,
      `Assistant profile age: ${assistantProfile.age || 'unknown'}.`,
      `Assistant profile pronouns: ${assistantProfile.pronouns || 'unknown'}.`,
      `Assistant profile appearance: ${assistantProfile.appearance || 'unspecified'}.`,
      `Assistant profile traits: ${(assistantProfile.traits || []).join(' | ') || 'none'}.`,
      `Assistant profile likes: ${(assistantProfile.likes || []).join(' | ') || 'none'}.`,
      `Assistant profile dislikes: ${(assistantProfile.dislikes || []).join(' | ') || 'none'}.`,
      'If user asks about your age, pronouns, appearance, or personal preferences, answer strictly using the assistant profile above and stay consistent.',
      'Do not repeat the same opener, same sentence pattern, or near-identical full reply across consecutive turns.',
      `Last assistant reply (for anti-repeat): ${recentAssistantLine || 'none'}.`,
      `Assistant style: ${assistantProfile.vibe || 'focused and natural'}.`,
      `Character blueprint core identity: ${(characterBlueprint.coreIdentity || []).join(' | ') || 'none'}.`,
      `Character blueprint speech style: ${(characterBlueprint.speechStyle || []).join(' | ') || 'none'}.`,
      `Character blueprint emotional rules: ${(characterBlueprint.emotionalRules || []).join(' | ') || 'none'}.`,
      `Consistency must-do rules: ${(consistencyProfile.mustDo || []).join(' | ') || 'none'}.`,
      `Consistency avoid phrases: ${(consistencyProfile.avoidPhrases || []).join(' | ') || 'none'}.`,
      'Webregel: Wenn eine zusätzliche Systemnachricht mit "Web-Kontext" vorhanden ist, behandle sie als aktuelle Internet-Recherche und nutze sie direkt.',
      'Webregel: Behaupte nicht pauschal "kein Internet", wenn Web-Kontext vorliegt. Falls kein Web-Kontext verfügbar ist, formuliere transparent, dass gerade kein Live-Treffer vorliegt.',
      'Webregel: Erfinde keine Quellen. Sage nie "Google-Datenbank". Nenne bei Web-Kontext die echte Quelle, z. B. DuckDuckGo Instant API oder Open-Meteo.',
      `Active mode: ${activeMode}.`,
      `Active mission: ${activeModeProfile.mission || 'unspecified'}.`,
      `Active character mode: ${activeModeProfile.characterMode || 'unspecified'}.`,
      `Active hard rules: ${(activeModeProfile.hardRules || []).join(' | ') || 'none'}.`,
      `User profile (config): age ${configUserProfile.age || 'unknown'}, pronouns ${configUserProfile.pronouns || 'unknown'}, style ${configUserProfile.style || 'unspecified'}, interests ${(configUserProfile.interests || []).join(' | ') || 'none'}.`,
      `Pinned memories (config): ${(memoryProfile.pinnedMemories || []).join(' | ') || 'none'}.`,
      `Pinned memories (chat-learned, ${memoryScopeLabel}): ${(learnedPinnedMemories || []).join(' | ') || 'none'}.`,
      ...modeDefinition.map((line) => this.renderTemplateString(line, {
        extraInstructions: extraInstructions.join(' | ') || 'keine',
        extraMemories: extraMemories.join(' | ') || 'keine',
      })),
      `Profilstil aktuell: ${user.profile.style || 'playful-supportive'}.`,
      `Ziele (${memoryScopeLabel}): ${(learnedGoals || []).join(' | ') || 'keine'}.`,
      `Bisher gelernte Präferenzen (${memoryScopeLabel}): ${(learnedNotes || []).join(' | ') || 'keine'}.`,
      `Langzeit-Summaries: ${summaries || 'keine'}.`,
      `Sprich den User bei Gelegenheit persönlich an: ${name}.`,
    ].join(' ');
  }
}

export default PromptBuilder;
