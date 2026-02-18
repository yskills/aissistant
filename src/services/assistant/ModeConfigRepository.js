import fs from 'fs';

class ModeConfigRepository {
  constructor({ configFilePath, allowedModes = ['normal', 'uncensored'] } = {}) {
    this.configFilePath = configFilePath;
    const requestedModes = Array.isArray(allowedModes) ? allowedModes : ['normal', 'uncensored'];
    const normalizedModes = requestedModes
      .map((mode) => String(mode || '').trim().toLowerCase())
      .filter(Boolean);
    this.allowedModes = normalizedModes.length ? [...new Set(normalizedModes)] : ['normal', 'uncensored'];
    this.cachedMtimeMs = null;
    this.cachedConfig = null;
  }

  static isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  static toString(value, fallback = '') {
    return String(value ?? fallback).trim();
  }

  static toStringArray(value, limit = 20) {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(-Math.max(1, Number(limit) || 1));
  }

  requireModes(objectName = 'value', map = {}) {
    const source = ModeConfigRepository.isPlainObject(map) ? map : {};
    this.allowedModes.forEach((mode) => {
      const value = ModeConfigRepository.toString(source[mode]);
      if (!value) {
        throw new Error(`${objectName} requires ${mode}`);
      }
    });
  }

  requireArrayModes(objectName = 'value', map = {}) {
    const source = ModeConfigRepository.isPlainObject(map) ? map : {};
    this.allowedModes.forEach((mode) => {
      if (!Array.isArray(source[mode])) {
        throw new Error(`${objectName} requires ${mode} array`);
      }
    });
  }

  getUiValue(ui = {}, key = '', profileKey = '') {
    const value = ModeConfigRepository.toString(ui[key]);
    if (!value) {
      throw new Error(`characterProfiles.${profileKey} requires ui.${key}`);
    }
    return value;
  }

  normalizeAssistantProfile(profile = {}, fallback = {}) {
    const source = ModeConfigRepository.isPlainObject(profile) ? profile : {};
    const fb = ModeConfigRepository.isPlainObject(fallback) ? fallback : {};

    return {
      name: ModeConfigRepository.toString(source.name, fb.name || ''),
      age: ModeConfigRepository.toString(source.age, fb.age || 'unknown'),
      pronouns: ModeConfigRepository.toString(source.pronouns, fb.pronouns || 'unknown'),
      appearance: ModeConfigRepository.toString(source.appearance, fb.appearance || ''),
      vibe: ModeConfigRepository.toString(source.vibe, fb.vibe || ''),
      traits: ModeConfigRepository.toStringArray(source.traits, 12),
      likes: ModeConfigRepository.toStringArray(source.likes, 12),
      dislikes: ModeConfigRepository.toStringArray(source.dislikes, 12),
    };
  }

  normalizeCharacterProfiles(characterProfiles = {}, globalAssistantProfile = {}) {
    if (!ModeConfigRepository.isPlainObject(characterProfiles)) {
      throw new Error('assistant-mode-config.local.json requires characterProfiles object');
    }

    return Object.entries(characterProfiles).reduce((acc, [id, profile]) => {
      const profileSource = ModeConfigRepository.isPlainObject(profile) ? profile : {};
      const profileId = ModeConfigRepository.toString(profileSource.id || id).toLowerCase();
      const name = ModeConfigRepository.toString(profileSource.name);
      const note = ModeConfigRepository.toString(profileSource.note);
      const tones = ModeConfigRepository.isPlainObject(profileSource.tones) ? profileSource.tones : {};
      const ui = ModeConfigRepository.isPlainObject(profileSource.ui) ? profileSource.ui : {};
      const definition = ModeConfigRepository.isPlainObject(profileSource.definition) ? { ...profileSource.definition } : {};

      if (!profileId || !name) {
        throw new Error(`characterProfiles.${id} requires id and name`);
      }

      this.requireModes(`characterProfiles.${id}.tones`, tones);

      const profileAssistant = this.normalizeAssistantProfile(
        definition.assistantProfile,
        {
          ...globalAssistantProfile,
          name: globalAssistantProfile.name || name,
        },
      );

      acc[profileId] = {
        id: profileId,
        name,
        note,
        tones: {
          ...this.allowedModes.reduce((modeMap, mode) => {
            modeMap[mode] = ModeConfigRepository.toString(tones[mode]);
            return modeMap;
          }, {}),
        },
        ui: {
          preview: this.getUiValue(ui, 'preview', id),
          assistantAccent: this.getUiValue(ui, 'assistantAccent', id),
          assistantAccent2: this.getUiValue(ui, 'assistantAccent2', id),
          assistantSoft: this.getUiValue(ui, 'assistantSoft', id),
          accent: this.getUiValue(ui, 'accent', id),
          accent2: this.getUiValue(ui, 'accent2', id),
          avatarClass: this.getUiValue(ui, 'avatarClass', id),
          titleClass: this.getUiValue(ui, 'titleClass', id),
        },
        definition: {
          ...definition,
          assistantProfile: profileAssistant,
        },
      };

      return acc;
    }, {});
  }

  normalizeBaseConfig(parsed = {}) {
    const assistant = ModeConfigRepository.isPlainObject(parsed.assistant) ? parsed.assistant : {};
    const promptDefinitions = ModeConfigRepository.isPlainObject(parsed.promptDefinitions) ? parsed.promptDefinitions : {};
    const userProfile = ModeConfigRepository.isPlainObject(parsed.userProfile) ? parsed.userProfile : {};
    const assistantProfileRaw = ModeConfigRepository.isPlainObject(parsed.assistantProfile) ? parsed.assistantProfile : {};
    const memoryProfile = ModeConfigRepository.isPlainObject(parsed.memoryProfile) ? parsed.memoryProfile : {};
    const uncensored = ModeConfigRepository.isPlainObject(parsed.uncensored) ? parsed.uncensored : {};
    const characterBlueprint = ModeConfigRepository.isPlainObject(parsed.characterBlueprint) ? parsed.characterBlueprint : {};
    const consistencyProfile = ModeConfigRepository.isPlainObject(parsed.consistencyProfile) ? parsed.consistencyProfile : {};
    const modeProfiles = ModeConfigRepository.isPlainObject(parsed.modeProfiles) ? parsed.modeProfiles : {};

    const character = ModeConfigRepository.toString(assistant.character);
    const language = ModeConfigRepository.toString(assistant.language);
    const defaultCharacterId = ModeConfigRepository.toString(assistant.defaultCharacterId).toLowerCase();

    if (!language) {
      throw new Error('assistant-mode-config.local.json requires assistant.language');
    }

    if (!defaultCharacterId) {
      throw new Error('assistant-mode-config.local.json requires assistant.defaultCharacterId');
    }

    this.requireArrayModes('assistant-mode-config.local.json promptDefinitions', promptDefinitions);

    const globalAssistantProfile = this.normalizeAssistantProfile(assistantProfileRaw, {
      name: character || 'Assistant',
      age: 'unknown',
      pronouns: 'unknown',
      appearance: '',
      vibe: 'focused and natural',
    });

    return {
      assistant: {
        character: character || globalAssistantProfile.name,
        language,
        defaultCharacterId,
      },
      assistantProfile: globalAssistantProfile,
      userProfile: {
        fixedPreferredName: ModeConfigRepository.toString(userProfile.fixedPreferredName),
        age: ModeConfigRepository.toString(userProfile.age),
        pronouns: ModeConfigRepository.toString(userProfile.pronouns),
        style: ModeConfigRepository.toString(userProfile.style),
        interests: ModeConfigRepository.toStringArray(userProfile.interests, 20),
      },
      memoryProfile: {
        pinnedMemories: ModeConfigRepository.toStringArray(memoryProfile.pinnedMemories, 40),
        maxPinnedMemories: Number(memoryProfile.maxPinnedMemories || 40),
        doNotLearn: ModeConfigRepository.toStringArray(memoryProfile.doNotLearn, 50),
      },
      promptDefinitions: {
        ...this.allowedModes.reduce((modeMap, mode) => {
          modeMap[mode] = ModeConfigRepository.toStringArray(promptDefinitions[mode], 120);
          return modeMap;
        }, {}),
      },
      uncensored: {
        instructions: ModeConfigRepository.toStringArray(uncensored.instructions, 30),
        memories: ModeConfigRepository.toStringArray(uncensored.memories, 60),
      },
      characterBlueprint: {
        coreIdentity: ModeConfigRepository.toStringArray(characterBlueprint.coreIdentity, 20),
        speechStyle: ModeConfigRepository.toStringArray(characterBlueprint.speechStyle, 20),
        emotionalRules: ModeConfigRepository.toStringArray(characterBlueprint.emotionalRules, 20),
      },
      consistencyProfile: {
        avoidPhrases: ModeConfigRepository.toStringArray(consistencyProfile.avoidPhrases, 30),
        mustDo: ModeConfigRepository.toStringArray(consistencyProfile.mustDo, 30),
      },
      modeProfiles: {
        normal: {
          mission: ModeConfigRepository.toString(modeProfiles?.normal?.mission, 'personal-assistant'),
          characterMode: ModeConfigRepository.toString(modeProfiles?.normal?.characterMode, 'cute-supportive'),
          hardRules: ModeConfigRepository.toStringArray(modeProfiles?.normal?.hardRules, 20),
        },
        uncensored: {
          mission: ModeConfigRepository.toString(modeProfiles?.uncensored?.mission, 'companion'),
          characterMode: ModeConfigRepository.toString(modeProfiles?.uncensored?.characterMode, 'cute-dominant'),
          hardRules: ModeConfigRepository.toStringArray(modeProfiles?.uncensored?.hardRules, 20),
        },
      },
    };
  }

  readRawConfig() {
    if (!this.configFilePath || !fs.existsSync(this.configFilePath)) {
      throw new Error(`Missing config file: ${this.configFilePath}`);
    }

    try {
      const raw = fs.readFileSync(this.configFilePath, 'utf8');
      return JSON.parse(raw || '{}');
    } catch (error) {
      throw new Error(`Invalid assistant mode config JSON: ${error.message}`);
    }
  }

  load() {
    const stat = fs.statSync(this.configFilePath);
    if (this.cachedConfig && this.cachedMtimeMs === stat.mtimeMs) {
      return this.cachedConfig;
    }

    const parsed = this.readRawConfig();
    const normalizedBase = this.normalizeBaseConfig(parsed);
    const normalizedCharacterProfiles = this.normalizeCharacterProfiles(
      parsed.characterProfiles,
      normalizedBase.assistantProfile,
    );

    if (!normalizedCharacterProfiles[normalizedBase.assistant.defaultCharacterId]) {
      throw new Error('assistant.defaultCharacterId must exist in characterProfiles');
    }

    const normalized = {
      ...normalizedBase,
      characterProfiles: normalizedCharacterProfiles,
    };

    this.cachedMtimeMs = stat.mtimeMs;
    this.cachedConfig = normalized;
    return normalized;
  }
}

export default ModeConfigRepository;
