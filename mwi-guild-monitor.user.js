// ==UserScript==
// @name         MWI Guild Monitor
// @namespace    https://github.com/local/mwi-guild-monitor
// @version      0.2.0
// @description  Read-only guild roster and skill statistics for Milky Way Idle leaders and officers.
// @author       Jack
// @homepageURL  https://github.com/Jalex3722/mwi-guild-monitor
// @supportURL   https://github.com/Jalex3722/mwi-guild-monitor/issues
// @updateURL    https://raw.githubusercontent.com/Jalex3722/mwi-guild-monitor/main/mwi-guild-monitor.user.js
// @downloadURL  https://raw.githubusercontent.com/Jalex3722/mwi-guild-monitor/main/mwi-guild-monitor.user.js
// @match        https://milkywayidle.com/*
// @match        https://www.milkywayidle.com/*
// @match        https://test.milkywayidle.com/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

(function (factory) {
    "use strict";

    const core = factory();

    if (typeof module === "object" && module.exports) {
        module.exports = core;
    }

    if (typeof window !== "undefined" && typeof document !== "undefined") {
        startGuildMonitor(core);
    }
})(function createCore() {
    "use strict";

    const TOTAL_LEVEL_HRID = "/skills/total_level";

    function asObject(value) {
        return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    }

    function normalizeName(value) {
        return String(value || "").trim().toLocaleLowerCase();
    }

    function firstDefined(source, keys, fallback = null) {
        for (const key of keys) {
            if (source && source[key] !== undefined && source[key] !== null) {
                return source[key];
            }
        }
        return fallback;
    }

    function prettifyHrid(hrid) {
        const tail = String(hrid || "").split("/").filter(Boolean).pop() || "Unknown";
        return tail
            .split("_")
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" ");
    }

    function getSkillName(hrid, skillDetails = {}) {
        const detail = skillDetails[hrid] || {};
        return detail.name || detail.displayName || prettifyHrid(hrid);
    }

    function normalizeSkills(skills) {
        if (!Array.isArray(skills)) return [];

        return skills
            .map((skill) => {
                const hrid = firstDefined(skill, ["skillHrid", "hrid", "skillHRID"], "");
                const level = Number(firstDefined(skill, ["level", "skillLevel"], NaN));
                const experience = Number(firstDefined(skill, ["experience", "xp"], 0));

                if (!hrid || !Number.isFinite(level)) return null;

                return {
                    skillHrid: String(hrid),
                    level,
                    experience: Number.isFinite(experience) ? experience : 0,
                };
            })
            .filter(Boolean);
    }

    function getProfileIdentity(profile) {
        const sharable = asObject(profile && profile.sharableCharacter);
        const firstSkill = Array.isArray(profile && profile.characterSkills) ? profile.characterSkills[0] || {} : {};
        const id = firstDefined(
            profile,
            ["characterID", "characterId", "id"],
            firstDefined(sharable, ["id", "characterID", "characterId"], firstDefined(firstSkill, ["characterID", "characterId"], null)),
        );
        const name = firstDefined(profile, ["characterName", "name"], firstDefined(sharable, ["name"], ""));

        return {
            id: id === null || id === undefined ? "" : String(id),
            name: String(name || "").trim(),
        };
    }

    function normalizeProfile(profile, capturedAt = Date.now()) {
        const identity = getProfileIdentity(profile);
        const skills = normalizeSkills(profile && profile.characterSkills);

        if ((!identity.id && !identity.name) || skills.length === 0) return null;

        return {
            id: identity.id,
            name: identity.name,
            capturedAt,
            skills,
        };
    }

    function normalizeRoster(guildCharacterMap, guildSharableCharacterMap) {
        const guildCharacters = asObject(guildCharacterMap);
        const sharableCharacters = asObject(guildSharableCharacterMap);
        const keys = new Set([...Object.keys(guildCharacters), ...Object.keys(sharableCharacters)]);

        return [...keys]
            .map((key) => {
                const guildCharacter = asObject(guildCharacters[key]);
                const sharable = asObject(sharableCharacters[key]);
                const id = firstDefined(
                    guildCharacter,
                    ["characterID", "characterId", "id"],
                    firstDefined(sharable, ["characterID", "characterId", "id"], key),
                );
                const name = firstDefined(sharable, ["name"], firstDefined(guildCharacter, ["name", "characterName"], `Member ${id}`));

                return {
                    id: String(id),
                    name: String(name || `Member ${id}`),
                    role: String(firstDefined(guildCharacter, ["role", "guildRole", "guildRoleHrid", "roleHrid"], "member")),
                    status: String(firstDefined(guildCharacter, ["status", "guildStatus"], "joined")),
                    experience: Number(firstDefined(guildCharacter, ["experience", "guildExperience"], 0)) || 0,
                    weeklyExperience: Number(firstDefined(guildCharacter, ["weeklyExperience", "weeklyGuildExperience"], 0)) || 0,
                    isOnline: Boolean(firstDefined(sharable, ["isOnline", "online"], false)),
                    lastActiveAt: firstDefined(sharable, ["inactiveTime", "lastOfflineTime"], firstDefined(guildCharacter, ["lastActiveAt", "lastOnlineAt", "updatedAt"], null)),
                    actionType: String(firstDefined(sharable, ["actionType"], "")),
                    hideOnlineStatus: Boolean(firstDefined(sharable, ["hideOnlineStatus"], false)),
                    joinedAt: firstDefined(guildCharacter, ["joinTime", "joinedAt", "createdAt"], null),
                    signedUpSkillingTrialHrid: String(firstDefined(guildCharacter, ["signedUpSkillingTrialHrid"], "")),
                    signedUpCombatTrialHrid: String(firstDefined(guildCharacter, ["signedUpCombatTrialHrid"], "")),
                    signedUpCombatRoleHrid: String(firstDefined(guildCharacter, ["signedUpCombatRoleHrid"], "")),
                    signupWeekStartAt: firstDefined(guildCharacter, ["signupWeekStartAt"], null),
                };
            })
            .filter((member) => !member.status || member.status === "joined")
            .sort((left, right) => left.name.localeCompare(right.name));
    }

    function matchProfilesToRoster(roster, profiles) {
        const byId = new Map();
        const byName = new Map();

        Object.values(asObject(profiles)).forEach((profile) => {
            if (!profile) return;
            if (profile.id) byId.set(String(profile.id), profile);
            if (profile.name) byName.set(normalizeName(profile.name), profile);
        });

        return roster.map((member) => ({
            ...member,
            profile: byId.get(String(member.id)) || byName.get(normalizeName(member.name)) || null,
        }));
    }

    function aggregateGuild(roster, profiles, skillDetails = {}) {
        const members = matchProfilesToRoster(roster, profiles);
        const coveredMembers = members.filter((member) => member.profile && member.profile.skills.length > 0);
        const skillRows = new Map();

        coveredMembers.forEach((member) => {
            member.profile.skills.forEach((skill) => {
                if (!skillRows.has(skill.skillHrid)) {
                    skillRows.set(skill.skillHrid, []);
                }
                skillRows.get(skill.skillHrid).push({
                    memberId: member.id,
                    memberName: member.name,
                    level: skill.level,
                    experience: skill.experience,
                });
            });
        });

        const skills = [...skillRows.entries()]
            .map(([skillHrid, entries]) => {
                const total = entries.reduce((sum, entry) => sum + entry.level, 0);
                const minLevel = Math.min(...entries.map((entry) => entry.level));
                const maxLevel = Math.max(...entries.map((entry) => entry.level));
                const minMembers = entries.filter((entry) => entry.level === minLevel).map((entry) => entry.memberName);
                const maxMembers = entries.filter((entry) => entry.level === maxLevel).map((entry) => entry.memberName);

                return {
                    skillHrid,
                    name: getSkillName(skillHrid, skillDetails),
                    average: entries.length ? total / entries.length : 0,
                    minLevel,
                    maxLevel,
                    minMembers,
                    maxMembers,
                    sampleSize: entries.length,
                };
            })
            .sort((left, right) => {
                if (left.skillHrid === TOTAL_LEVEL_HRID) return -1;
                if (right.skillHrid === TOTAL_LEVEL_HRID) return 1;
                return left.name.localeCompare(right.name);
            });

        return {
            memberCount: members.length,
            coveredCount: coveredMembers.length,
            coverage: members.length ? coveredMembers.length / members.length : 0,
            members,
            skills,
            missingMembers: members.filter((member) => !member.profile),
        };
    }

    function parseJsonObject(value) {
        if (!value) return {};
        if (typeof value === "object" && !Array.isArray(value)) return value;
        try {
            return asObject(JSON.parse(value));
        } catch (_error) {
            return {};
        }
    }

    function toTimestamp(value) {
        if (value === null || value === undefined || value === "") return null;
        if (typeof value === "number") return value < 10_000_000_000 ? value * 1000 : value;
        const numeric = Number(value);
        if (Number.isFinite(numeric) && String(value).trim() !== "") {
            return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
        }
        const parsed = new Date(value).getTime();
        return Number.isFinite(parsed) ? parsed : null;
    }

    function currentGuildWeekStart(timestamp = Date.now()) {
        const date = new Date(timestamp);
        const midnightUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
        return midnightUtc - ((date.getUTCDay() - 5 + 7) % 7) * 86_400_000;
    }

    function isCurrentSignup(member, guildWeekStartAt, now = Date.now()) {
        if (!member || !member.signupWeekStartAt) return true;
        const signupStart = toTimestamp(member.signupWeekStartAt);
        const guildStart = toTimestamp(guildWeekStartAt);
        if (signupStart === null) return true;
        if (guildStart !== null) return signupStart === guildStart;
        return signupStart === currentGuildWeekStart(now);
    }

    function getTrialName(trialHrid, trialDetails = {}, skillDetails = {}) {
        const detail = trialDetails[trialHrid] || {};
        const skillHrid = detail.skillHrid || "";
        if (skillHrid) return getSkillName(skillHrid, skillDetails);
        return detail.name || prettifyHrid(trialHrid).replace(/^Guild Combat\s+/i, "").replace(/^Trial\s+/i, "");
    }

    function getProfileSkillLevel(member, skillHrid) {
        if (!member || !member.profile || !skillHrid) return null;
        const skill = member.profile.skills.find((entry) => entry.skillHrid === skillHrid);
        return skill ? skill.level : null;
    }

    function strongestSkill(member, skillDetails = {}) {
        if (!member || !member.profile) return null;
        const skills = member.profile.skills
            .filter((skill) => skill.skillHrid !== TOTAL_LEVEL_HRID)
            .sort((left, right) => right.level - left.level || getSkillName(left.skillHrid, skillDetails).localeCompare(getSkillName(right.skillHrid, skillDetails)));
        if (!skills.length) return null;
        return { ...skills[0], name: getSkillName(skills[0].skillHrid, skillDetails) };
    }

    function analyzeTrials({
        aggregate,
        weeklyTrialSet = {},
        trialDetails = {},
        signupLevels = {},
        trialMinLevels = {},
        guildWeekStartAt = null,
        skillDetails = {},
        now = Date.now(),
    }) {
        const skillingHrids = Array.isArray(weeklyTrialSet.skillHrids) ? weeklyTrialSet.skillHrids : [];
        const combatHrids = Array.isArray(weeklyTrialSet.combatHrids) ? weeklyTrialSet.combatHrids : [];
        const minimums = parseJsonObject(trialMinLevels);
        const currentMembers = aggregate.members.map((member) => {
            const active = isCurrentSignup(member, guildWeekStartAt, now);
            return {
                ...member,
                currentSkillingTrialHrid: active ? member.signedUpSkillingTrialHrid : "",
                currentCombatTrialHrid: active ? member.signedUpCombatTrialHrid : "",
                currentCombatRoleHrid: active ? member.signedUpCombatRoleHrid : "",
            };
        });

        const makeTrial = (trialHrid, kind) => {
            const detail = trialDetails[trialHrid] || {};
            const signups = currentMembers
                .filter((member) => (kind === "combat" ? member.currentCombatTrialHrid : member.currentSkillingTrialHrid) === trialHrid)
                .map((member) => {
                    const levels = signupLevels[member.id] || {};
                    const signupLevel = Number(kind === "combat" ? levels.combatLevel : levels.skillingTrialLevel);
                    const profileLevel = kind === "skilling" ? getProfileSkillLevel(member, detail.skillHrid) : null;
                    return {
                        memberId: member.id,
                        memberName: member.name,
                        level: Number.isFinite(signupLevel) && signupLevel > 0 ? signupLevel : profileLevel,
                        roleHrid: kind === "combat" ? member.currentCombatRoleHrid : "",
                    };
                })
                .sort((left, right) => (right.level || 0) - (left.level || 0) || left.memberName.localeCompare(right.memberName));
            const knownLevels = signups.map((entry) => entry.level).filter(Number.isFinite);
            const roles = signups.reduce((result, entry) => {
                const role = entry.roleHrid || "unselected";
                result[role] = (result[role] || 0) + 1;
                return result;
            }, {});

            return {
                trialHrid,
                kind,
                name: getTrialName(trialHrid, trialDetails, skillDetails),
                skillHrid: detail.skillHrid || "",
                minLevel: Number(minimums[trialHrid]) || 0,
                signups,
                signupCount: signups.length,
                averageLevel: knownLevels.length ? knownLevels.reduce((sum, level) => sum + level, 0) / knownLevels.length : null,
                minSignupLevel: knownLevels.length ? Math.min(...knownLevels) : null,
                maxSignupLevel: knownLevels.length ? Math.max(...knownLevels) : null,
                roles,
            };
        };

        const skilling = skillingHrids.map((hrid) => makeTrial(hrid, "skilling"));
        const combat = combatHrids.map((hrid) => makeTrial(hrid, "combat"));
        const recommendations = buildSkillingRecommendations(currentMembers, skilling);

        return {
            hasTrialData: skilling.length > 0 || combat.length > 0,
            skilling,
            combat,
            recommendations,
            skillingSignedCount: currentMembers.filter((member) => member.currentSkillingTrialHrid).length,
            combatSignedCount: currentMembers.filter((member) => member.currentCombatTrialHrid).length,
            unsignedSkilling: currentMembers.filter((member) => !member.currentSkillingTrialHrid),
            unsignedCombat: currentMembers.filter((member) => !member.currentCombatTrialHrid),
        };
    }

    function buildSkillingRecommendations(members, trials) {
        if (!trials.length) return [];
        const candidates = members
            .map((member) => {
                const options = trials
                    .map((trial) => ({
                        trial,
                        level: getProfileSkillLevel(member, trial.skillHrid),
                    }))
                    .filter((option) => Number.isFinite(option.level) && (trialAllowsLevel(option.trial, option.level)));
                options.sort((left, right) => right.level - left.level || left.trial.name.localeCompare(right.trial.name));
                return { member, options, specialization: options.length > 1 ? options[0].level - options[1].level : options.length ? options[0].level : -1 };
            })
            .filter((candidate) => candidate.options.length)
            .sort((left, right) => right.specialization - left.specialization || left.member.name.localeCompare(right.member.name));

        const maxPerTrial = Math.ceil(candidates.length / trials.length);
        const recommendedCounts = Object.fromEntries(trials.map((trial) => [trial.trialHrid, 0]));
        const actualCounts = Object.fromEntries(trials.map((trial) => [trial.trialHrid, trial.signupCount]));
        const assignments = [];

        candidates.forEach((candidate) => {
            const option = candidate.options.find((entry) => recommendedCounts[entry.trial.trialHrid] < maxPerTrial) || candidate.options[0];
            recommendedCounts[option.trial.trialHrid] += 1;
            const currentHrid = candidate.member.currentSkillingTrialHrid;
            const currentTrial = trials.find((trial) => trial.trialHrid === currentHrid) || null;
            const currentLevel = currentTrial ? getProfileSkillLevel(candidate.member, currentTrial.skillHrid) : null;
            const isAligned = currentHrid === option.trial.trialHrid;
            let reason = "Highest-level fit in the balanced allocation";
            if (!currentHrid) {
                reason = "Not signed up; best fit from captured levels";
            } else if (!isAligned && Number.isFinite(currentLevel) && option.level > currentLevel) {
                reason = `${option.level - currentLevel} levels stronger than the current signup`;
            } else if (!isAligned) {
                reason = `Balances current rosters (${actualCounts[currentHrid] || 0} vs ${actualCounts[option.trial.trialHrid] || 0})`;
            }

            assignments.push({
                memberId: candidate.member.id,
                memberName: candidate.member.name,
                currentTrialHrid: currentHrid,
                currentTrialName: currentTrial ? currentTrial.name : "Not signed up",
                currentLevel,
                recommendedTrialHrid: option.trial.trialHrid,
                recommendedTrialName: option.trial.name,
                recommendedLevel: option.level,
                isAligned,
                reason,
            });
        });

        return assignments.sort((left, right) => {
            if (left.isAligned !== right.isAligned) return left.isAligned ? 1 : -1;
            return left.memberName.localeCompare(right.memberName);
        });
    }

    function trialAllowsLevel(trial, level) {
        return !trial.minLevel || level >= trial.minLevel;
    }

    function makeSnapshot(guild, aggregate, capturedAt = Date.now(), trialAnalysis = null) {
        const snapshot = {
            capturedAt,
            guildId: guild && guild.id !== undefined ? String(guild.id) : "",
            guildName: guild && guild.name ? guild.name : "Unknown guild",
            memberCount: aggregate.memberCount,
            coveredCount: aggregate.coveredCount,
            skills: aggregate.skills.reduce((result, skill) => {
                result[skill.skillHrid] = {
                    average: Number(skill.average.toFixed(4)),
                    minLevel: skill.minLevel,
                    maxLevel: skill.maxLevel,
                    sampleSize: skill.sampleSize,
                };
                return result;
            }, {}),
        };
        if (trialAnalysis) {
            snapshot.trials = {
                skillingSignedCount: trialAnalysis.skillingSignedCount,
                combatSignedCount: trialAnalysis.combatSignedCount,
                skilling: Object.fromEntries(trialAnalysis.skilling.map((trial) => [trial.trialHrid, trial.signupCount])),
                combat: Object.fromEntries(trialAnalysis.combat.map((trial) => [trial.trialHrid, trial.signupCount])),
            };
        }
        return snapshot;
    }

    function getPreviousSnapshot(snapshots, currentCapturedAt = Date.now()) {
        return [...(Array.isArray(snapshots) ? snapshots : [])]
            .filter((snapshot) => snapshot && snapshot.capturedAt < currentCapturedAt)
            .sort((left, right) => right.capturedAt - left.capturedAt)[0] || null;
    }

    function toCsv(aggregate, skillDetails = {}, trialDetails = {}) {
        const skillHrids = aggregate.skills.map((skill) => skill.skillHrid);
        const header = ["Member", "Role", "Guild XP", "Weekly Guild XP", "Skilling Trial", "Combat Trial", "Combat Role", "Captured At", ...skillHrids.map((hrid) => getSkillName(hrid, skillDetails))];
        const rows = aggregate.members.map((member) => {
            const profile = member.profile;
            const skillMap = new Map((profile ? profile.skills : []).map((skill) => [skill.skillHrid, skill.level]));
            return [
                member.name,
                prettifyHrid(member.role),
                member.experience,
                member.weeklyExperience,
                member.signedUpSkillingTrialHrid ? getTrialName(member.signedUpSkillingTrialHrid, trialDetails, skillDetails) : "",
                member.signedUpCombatTrialHrid ? getTrialName(member.signedUpCombatTrialHrid, trialDetails, skillDetails) : "",
                member.signedUpCombatRoleHrid ? prettifyHrid(member.signedUpCombatRoleHrid) : "",
                profile ? new Date(profile.capturedAt).toISOString() : "",
                ...skillHrids.map((hrid) => (skillMap.has(hrid) ? skillMap.get(hrid) : "")),
            ];
        });

        return [header, ...rows]
            .map((row) => row.map(csvCell).join(","))
            .join("\r\n");
    }

    function csvCell(value) {
        const text = String(value === null || value === undefined ? "" : value);
        return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    return {
        TOTAL_LEVEL_HRID,
        aggregateGuild,
        analyzeTrials,
        asObject,
        getPreviousSnapshot,
        getProfileIdentity,
        getSkillName,
        getTrialName,
        makeSnapshot,
        normalizeName,
        normalizeProfile,
        normalizeRoster,
        normalizeSkills,
        parseJsonObject,
        prettifyHrid,
        strongestSkill,
        toCsv,
    };
});

function startGuildMonitor(Core) {
    "use strict";

    const SCRIPT_ID = "mwi-guild-monitor";
    const STORAGE_KEY = `${SCRIPT_ID}:v1`;
    const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    const state = {
        guild: null,
        guildCharacterMap: {},
        guildSharableCharacterMap: {},
        guildTrialSignupLevelMap: {},
        guildWeeklyTrialSet: { skillHrids: [], combatHrids: [] },
        guildTrialDetails: {},
        skillDetails: {},
        ownCharacter: null,
        guildStore: null,
        isOpen: false,
        activeTab: "skills",
        query: "",
        sort: "name",
        lastMessageAt: null,
        renderQueued: false,
    };

    function defaultStore() {
        return { version: 1, guilds: {} };
    }

    function readStore() {
        try {
            const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
            return parsed && parsed.version === 1 && parsed.guilds ? parsed : defaultStore();
        } catch (_error) {
            return defaultStore();
        }
    }

    function writeStore(store) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
        } catch (error) {
            console.warn("[MWI Guild Monitor] Could not save local data.", error);
        }
    }

    function guildKey(guild = state.guild) {
        if (!guild) return "unknown";
        return String(guild.id ?? Core.normalizeName(guild.name) ?? "unknown");
    }

    function ensureGuildStore() {
        const store = readStore();
        const key = guildKey();
        const previous = store.guilds[key] || {};
        store.guilds[key] = {
            name: state.guild && state.guild.name ? state.guild.name : previous.name || "Unknown guild",
            profiles: previous.profiles || {},
            snapshots: Array.isArray(previous.snapshots) ? previous.snapshots : [],
        };
        state.guildStore = store.guilds[key];
        return { store, key };
    }

    function saveProfile(profile) {
        const normalized = Core.normalizeProfile(profile);
        if (!normalized || !state.guild) return false;

        const roster = Core.normalizeRoster(state.guildCharacterMap, state.guildSharableCharacterMap);
        const member = roster.find((entry) =>
            (normalized.id && entry.id === normalized.id) ||
            (normalized.name && Core.normalizeName(entry.name) === Core.normalizeName(normalized.name)),
        );

        if (!member) return false;

        const { store, key } = ensureGuildStore();
        const profileKey = member.id || Core.normalizeName(member.name);
        store.guilds[key].profiles[profileKey] = {
            ...normalized,
            id: member.id,
            name: member.name,
        };
        writeStore(store);
        state.guildStore = store.guilds[key];
        return true;
    }

    function mergeOwnSkillUpdates(updates) {
        if (!state.ownCharacter || !Array.isArray(updates) || updates.length === 0) return;
        const { store, key } = ensureGuildStore();
        const profileKey = String(state.ownCharacter.id || Core.normalizeName(state.ownCharacter.name));
        const profile = store.guilds[key].profiles[profileKey];
        if (!profile) return;

        const skillMap = new Map(profile.skills.map((skill) => [skill.skillHrid, skill]));
        Core.normalizeSkills(updates).forEach((skill) => skillMap.set(skill.skillHrid, skill));
        profile.skills = [...skillMap.values()];
        profile.capturedAt = Date.now();
        writeStore(store);
        state.guildStore = store.guilds[key];
    }

    function handleGameMessage(message) {
        if (!message || typeof message !== "object") return;
        state.lastMessageAt = Date.now();

        switch (message.type) {
            case "init_client_data":
                state.skillDetails = message.skillDetailMap || message.skillDetailDict || state.skillDetails;
                state.guildTrialDetails = message.guildTrialDetailMap || state.guildTrialDetails;
                break;
            case "init_character_data":
                state.guild = message.guild || null;
                state.guildCharacterMap = message.guildCharacterMap || {};
                state.guildSharableCharacterMap = message.guildSharableCharacterMap || {};
                state.guildTrialSignupLevelMap = message.guildTrialSignupLevelMap || {};
                state.guildWeeklyTrialSet = message.guildWeeklyTrialSet || { skillHrids: [], combatHrids: [] };
                state.ownCharacter = message.character || null;
                if (state.guild) {
                    ensureGuildStore();
                    saveProfile({
                        characterID: message.character && message.character.id,
                        characterName: message.character && message.character.name,
                        sharableCharacter: message.character,
                        characterSkills: message.characterSkills,
                    });
                }
                break;
            case "guild_updated":
                state.guild = message.guild || null;
                state.guildWeeklyTrialSet = message.guildWeeklyTrialSet || state.guildWeeklyTrialSet;
                if (state.guild) ensureGuildStore();
                break;
            case "guild_characters_updated":
                state.guildCharacterMap = message.guildCharacterMap || {};
                state.guildSharableCharacterMap = message.guildSharableCharacterMap || {};
                state.guildTrialSignupLevelMap = message.guildTrialSignupLevelMap || {};
                break;
            case "guild_trial_signup_updated": {
                const id = String(message.characterId);
                const existing = state.guildCharacterMap[id] || state.guildCharacterMap[message.characterId];
                if (existing) {
                    state.guildCharacterMap = {
                        ...state.guildCharacterMap,
                        [id]: {
                            ...existing,
                            signedUpSkillingTrialHrid: message.signedUpSkillingTrialHrid || "",
                            signedUpSkillingLoadoutID: message.signedUpSkillingLoadoutID || 0,
                            signedUpCombatTrialHrid: message.signedUpCombatTrialHrid || "",
                            signedUpCombatLoadoutID: message.signedUpCombatLoadoutID || 0,
                            signedUpCombatRoleHrid: message.signedUpCombatRoleHrid || "",
                            signupWeekStartAt: message.signupWeekStartAt || null,
                        },
                    };
                }
                state.guildTrialSignupLevelMap = {
                    ...state.guildTrialSignupLevelMap,
                    [id]: message.trialSignupLevels || {},
                };
                break;
            }
            case "profile_shared":
                saveProfile(message.profile);
                break;
            case "skills_updated":
                mergeOwnSkillUpdates(message.endCharacterSkills || []);
                break;
            default:
                return;
        }

        queueRender();
    }

    function installWebSocketObserver() {
        const prototype = pageWindow.MessageEvent && pageWindow.MessageEvent.prototype;
        const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, "data");
        if (!descriptor || typeof descriptor.get !== "function") {
            console.warn("[MWI Guild Monitor] MessageEvent.data could not be observed.");
            return;
        }

        const originalGet = descriptor.get;
        const seenEvents = new WeakSet();

        Object.defineProperty(prototype, "data", {
            ...descriptor,
            get: function guildMonitorDataGetter() {
                const value = originalGet.call(this);

                try {
                    const socket = this.currentTarget;
                    const isGameSocket = socket instanceof pageWindow.WebSocket &&
                        /api(?:-test)?\.milkywayidle(?:cn)?\.com\/ws/i.test(String(socket.url || ""));

                    if (isGameSocket && typeof value === "string" && !seenEvents.has(this)) {
                        seenEvents.add(this);
                        const parsed = JSON.parse(value);
                        queueMicrotask(() => handleGameMessage(parsed));
                    }
                } catch (_error) {
                    // The game may also receive non-JSON messages. They are irrelevant here.
                }

                return value;
            },
        });
    }

    function injectStyles() {
        if (document.getElementById(`${SCRIPT_ID}-styles`)) return;
        const style = document.createElement("style");
        style.id = `${SCRIPT_ID}-styles`;
        style.textContent = `
            #${SCRIPT_ID}-button {
                position: fixed; right: 16px; bottom: 18px; z-index: 2147483645;
                width: 44px; height: 44px; border: 1px solid #5d7397; border-radius: 6px;
                background: #18243a; color: #f4f7fb; font: 700 15px/1 system-ui, sans-serif;
                box-shadow: 0 6px 18px rgba(0,0,0,.35); cursor: pointer;
            }
            #${SCRIPT_ID}-button:hover { background: #223453; }
            #${SCRIPT_ID}-button[data-alert="true"]::after {
                content: ""; position: absolute; right: 5px; top: 5px; width: 7px; height: 7px;
                border-radius: 50%; background: #f5b642;
            }
            #${SCRIPT_ID}-panel {
                position: fixed; top: 12px; right: 12px; bottom: 12px; z-index: 2147483646;
                width: min(760px, calc(100vw - 24px)); color: #e9eef7; background: #101827;
                border: 1px solid #40516f; border-radius: 8px; box-shadow: 0 18px 50px rgba(0,0,0,.55);
                font: 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                display: flex; flex-direction: column; overflow: hidden;
            }
            #${SCRIPT_ID}-panel[hidden] { display: none; }
            #${SCRIPT_ID}-panel, #${SCRIPT_ID}-panel * { box-sizing: border-box; }
            .mwigm-header { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid #31415c; }
            .mwigm-title { min-width: 0; flex: 1; }
            .mwigm-title strong { display: block; font-size: 16px; color: #fff; }
            .mwigm-title span { display: block; color: #aab7ca; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .mwigm-icon-button { width: 32px; height: 32px; padding: 0; border: 1px solid #526580; border-radius: 5px; background: #1a2740; color: #eef3fa; cursor: pointer; font-size: 18px; }
            .mwigm-icon-button:hover { background: #253756; }
            .mwigm-status { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-bottom: 1px solid #31415c; background: #141f33; }
            .mwigm-metric { padding: 10px 12px; border-right: 1px solid #31415c; min-width: 0; }
            .mwigm-metric:last-child { border-right: 0; }
            .mwigm-metric-label { color: #9cabc0; font-size: 11px; text-transform: uppercase; }
            .mwigm-metric-value { display: block; margin-top: 2px; color: #fff; font-size: 18px; font-weight: 650; }
            .mwigm-tabs { display: flex; gap: 2px; padding: 8px 10px 0; border-bottom: 1px solid #31415c; background: #101827; }
            .mwigm-tab { min-height: 34px; padding: 7px 11px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #aebbd0; cursor: pointer; }
            .mwigm-tab[aria-selected="true"] { color: #fff; border-bottom-color: #66c7a5; }
            .mwigm-toolbar { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #263651; }
            .mwigm-input, .mwigm-select { min-width: 0; height: 32px; border: 1px solid #526580; border-radius: 5px; background: #0c1422; color: #f3f6fa; padding: 5px 8px; }
            .mwigm-input { flex: 1; }
            .mwigm-command { height: 32px; border: 1px solid #526580; border-radius: 5px; background: #1a2942; color: #f1f5fb; padding: 5px 10px; cursor: pointer; white-space: nowrap; }
            .mwigm-command:hover { background: #263a5d; }
            .mwigm-command-primary { border-color: #4c9b82; background: #17634f; }
            .mwigm-command-primary:hover { background: #1d775f; }
            .mwigm-content { min-height: 0; flex: 1; overflow: auto; }
            .mwigm-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
            .mwigm-table th { position: sticky; top: 0; z-index: 1; padding: 8px 10px; background: #18243a; color: #afbdd0; font-weight: 600; text-align: right; border-bottom: 1px solid #40516f; }
            .mwigm-table th:first-child { text-align: left; }
            .mwigm-table td { padding: 8px 10px; border-bottom: 1px solid #24334b; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .mwigm-table td:first-child { text-align: left; }
            .mwigm-table tbody tr:hover { background: #17243a; }
            .mwigm-skill-name, .mwigm-member-name { color: #f6f8fc; font-weight: 600; }
            .mwigm-subtext { color: #92a2b9; font-size: 11px; }
            .mwigm-up { color: #68d5a9; }
            .mwigm-muted { color: #93a2b7; }
            .mwigm-missing { color: #f1bd67; }
            .mwigm-notice { margin: 12px; padding: 10px 12px; border-left: 3px solid #e2a84b; background: #211d17; color: #e9dfcd; }
            .mwigm-empty { padding: 44px 22px; text-align: center; color: #a8b5c8; }
            .mwigm-empty strong { display: block; color: #edf2f8; font-size: 15px; margin-bottom: 5px; }
            .mwigm-list { margin: 0; padding: 0; list-style: none; }
            .mwigm-list li { display: flex; gap: 10px; align-items: center; padding: 9px 12px; border-bottom: 1px solid #24334b; }
            .mwigm-list li > span:first-child { flex: 1; min-width: 0; }
            .mwigm-section-title { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 13px 12px 7px; border-bottom: 1px solid #31415c; color: #f3f6fb; font-size: 14px; font-weight: 650; }
            .mwigm-section-title span { color: #8fa0b7; font-size: 11px; font-weight: 400; }
            .mwigm-trial-name { font-weight: 650; color: #f4f7fb; }
            .mwigm-chip { display: inline-block; padding: 1px 5px; border: 1px solid #536681; border-radius: 4px; color: #bdc9d9; font-size: 11px; white-space: nowrap; }
            .mwigm-chip-good { border-color: #3f9076; color: #77d2b2; }
            .mwigm-chip-warn { border-color: #9d7335; color: #efbd70; }
            .mwigm-member-skills { display: block; color: #aebbd0; font-size: 11px; }
            .mwigm-footer { padding: 8px 12px; color: #8190a6; font-size: 11px; border-top: 1px solid #31415c; }
            @media (max-width: 620px) {
                #${SCRIPT_ID}-panel { top: 0; right: 0; bottom: 0; width: 100vw; border-radius: 0; }
                .mwigm-status { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                .mwigm-metric:nth-child(2) { border-right: 0; }
                .mwigm-metric:nth-child(-n+2) { border-bottom: 1px solid #31415c; }
                .mwigm-toolbar { flex-wrap: wrap; }
                .mwigm-input { flex-basis: 100%; }
                .mwigm-table th:nth-child(5), .mwigm-table td:nth-child(5) { display: none; }
            }
        `;
        document.head.appendChild(style);
    }

    function createShell() {
        if (document.getElementById(`${SCRIPT_ID}-panel`)) return;
        injectStyles();

        const button = document.createElement("button");
        button.id = `${SCRIPT_ID}-button`;
        button.type = "button";
        button.textContent = "GM";
        button.title = "Open MWI Guild Monitor";
        button.addEventListener("click", () => {
            state.isOpen = true;
            render();
        });

        const panel = document.createElement("section");
        panel.id = `${SCRIPT_ID}-panel`;
        panel.hidden = true;
        panel.setAttribute("aria-label", "MWI Guild Monitor");
        panel.innerHTML = `
            <header class="mwigm-header">
                <div class="mwigm-title"><strong>Guild Monitor</strong><span>Waiting for game data</span></div>
                <button class="mwigm-icon-button" type="button" data-action="close" title="Close Guild Monitor" aria-label="Close Guild Monitor">&times;</button>
            </header>
            <div class="mwigm-status"></div>
            <nav class="mwigm-tabs" aria-label="Guild Monitor views">
                <button class="mwigm-tab" type="button" data-tab="skills">Skills</button>
                <button class="mwigm-tab" type="button" data-tab="members">Members</button>
                <button class="mwigm-tab" type="button" data-tab="trials">Trials</button>
                <button class="mwigm-tab" type="button" data-tab="missing">Missing profiles</button>
            </nav>
            <div class="mwigm-toolbar"></div>
            <div class="mwigm-content"></div>
            <footer class="mwigm-footer">Read-only. Data stays in this browser and updates when profiles are viewed.</footer>
        `;

        panel.addEventListener("click", handlePanelClick);
        panel.addEventListener("input", handlePanelInput);
        panel.addEventListener("change", handlePanelInput);
        document.body.append(button, panel);
        render();
    }

    function currentAggregate() {
        const roster = Core.normalizeRoster(state.guildCharacterMap, state.guildSharableCharacterMap);
        const profiles = state.guildStore ? state.guildStore.profiles : {};
        return Core.aggregateGuild(roster, profiles, state.skillDetails);
    }

    function currentTrialAnalysis(aggregate = currentAggregate()) {
        return Core.analyzeTrials({
            aggregate,
            weeklyTrialSet: state.guildWeeklyTrialSet,
            trialDetails: state.guildTrialDetails,
            signupLevels: state.guildTrialSignupLevelMap,
            trialMinLevels: state.guild && state.guild.trialMinLevelsData,
            guildWeekStartAt: state.guild && state.guild.currentWeekStartAt,
            skillDetails: state.skillDetails,
        });
    }

    function render() {
        const panel = document.getElementById(`${SCRIPT_ID}-panel`);
        const button = document.getElementById(`${SCRIPT_ID}-button`);
        if (!panel || !button) return;

        panel.hidden = !state.isOpen;
        const aggregate = currentAggregate();
        button.dataset.alert = String(Boolean(state.guild && aggregate.missingMembers.length));
        panel.querySelector(".mwigm-title span").textContent = state.guild
            ? state.guild.name || "Current guild"
            : "Open Milky Way Idle and join a guild";
        panel.querySelector(".mwigm-status").innerHTML = renderMetrics(aggregate);
        panel.querySelectorAll(".mwigm-tab").forEach((tab) => {
            tab.setAttribute("aria-selected", String(tab.dataset.tab === state.activeTab));
        });

        const toolbar = panel.querySelector(".mwigm-toolbar");
        const content = panel.querySelector(".mwigm-content");
        toolbar.innerHTML = renderToolbar(aggregate);
        content.innerHTML = renderContent(aggregate);
    }

    function renderMetrics(aggregate) {
        const totalSkill = aggregate.skills.find((skill) => skill.skillHrid === Core.TOTAL_LEVEL_HRID);
        return [
            metric("Members", aggregate.memberCount),
            metric("Profiles", `${aggregate.coveredCount}/${aggregate.memberCount}`),
            metric("Coverage", formatPercent(aggregate.coverage)),
            metric("Avg total", totalSkill ? totalSkill.average.toFixed(1) : "--"),
        ].join("");
    }

    function metric(label, value) {
        return `<div class="mwigm-metric"><span class="mwigm-metric-label">${escapeHtml(label)}</span><span class="mwigm-metric-value">${escapeHtml(value)}</span></div>`;
    }

    function renderToolbar(aggregate) {
        const searchPlaceholder = state.activeTab === "skills" ? "Find a skill" : state.activeTab === "trials" ? "Find a trial or member" : "Find a member";
        const sortOptions = state.activeTab === "skills"
            ? `<option value="name">Skill name</option><option value="average">Highest average</option><option value="max">Highest max</option><option value="min">Lowest min</option>`
            : state.activeTab === "trials"
            ? `<option value="name">Trial or member</option><option value="gap">Needs review first</option>`
            : `<option value="name">Member name</option><option value="total">Highest total</option><option value="freshness">Oldest profile</option>`;

        return `
            <input class="mwigm-input" data-control="query" type="search" placeholder="${searchPlaceholder}" value="${escapeHtml(state.query)}" aria-label="${searchPlaceholder}">
            <select class="mwigm-select" data-control="sort" aria-label="Sort results">${withSelectedOption(sortOptions, state.sort)}</select>
            <button class="mwigm-command" type="button" data-action="snapshot" ${aggregate.coveredCount ? "" : "disabled"}>Snapshot</button>
            <button class="mwigm-command mwigm-command-primary" type="button" data-action="export" ${aggregate.coveredCount ? "" : "disabled"}>Export CSV</button>
        `;
    }

    function renderContent(aggregate) {
        if (!state.guild) {
            return emptyState("No guild data yet", "Reload Milky Way Idle after enabling the userscript.");
        }
        if (!aggregate.memberCount) {
            return emptyState("Waiting for the roster", "Open the Guild panel or reload the game.");
        }
        if (state.activeTab === "members") return renderMembers(aggregate);
        if (state.activeTab === "trials") return renderTrials(aggregate);
        if (state.activeTab === "missing") return renderMissing(aggregate);
        return renderSkills(aggregate);
    }

    function renderSkills(aggregate) {
        if (!aggregate.coveredCount) {
            return `${coverageNotice(aggregate)}${emptyState("No profiles captured", "Open a guild member's Profile in the game. Each viewed profile is added automatically.")}`;
        }

        const previous = Core.getPreviousSnapshot(state.guildStore ? state.guildStore.snapshots : []);
        let skills = aggregate.skills.filter((skill) => skill.name.toLocaleLowerCase().includes(state.query.toLocaleLowerCase()));
        skills = sortSkills(skills);
        const rows = skills.map((skill) => {
            const oldValue = previous && previous.skills && previous.skills[skill.skillHrid];
            const delta = oldValue ? skill.average - oldValue.average : null;
            return `
                <tr title="Min: ${escapeHtml(skill.minMembers.join(", "))} | Max: ${escapeHtml(skill.maxMembers.join(", "))}">
                    <td><span class="mwigm-skill-name">${escapeHtml(skill.name)}</span><br><span class="mwigm-subtext">${skill.sampleSize} member${skill.sampleSize === 1 ? "" : "s"}</span></td>
                    <td>${skill.average.toFixed(1)}</td>
                    <td>${skill.minLevel}</td>
                    <td>${skill.maxLevel}</td>
                    <td class="${delta !== null && delta > 0 ? "mwigm-up" : "mwigm-muted"}">${formatDelta(delta)}</td>
                </tr>
            `;
        }).join("");

        return `${coverageNotice(aggregate)}<table class="mwigm-table"><thead><tr><th style="width:38%">Skill</th><th>Average</th><th>Min</th><th>Max</th><th>Change</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    function renderMembers(aggregate) {
        let members = aggregate.members.filter((member) => member.name.toLocaleLowerCase().includes(state.query.toLocaleLowerCase()));
        members = sortMembers(members);
        const rows = members.map((member) => {
            const profile = member.profile;
            const total = profile ? profile.skills.find((skill) => skill.skillHrid === Core.TOTAL_LEVEL_HRID) : null;
            const strongest = Core.strongestSkill(member, state.skillDetails);
            const skillingTrial = member.signedUpSkillingTrialHrid ? Core.getTrialName(member.signedUpSkillingTrialHrid, state.guildTrialDetails, state.skillDetails) : "None";
            const combatTrial = member.signedUpCombatTrialHrid ? Core.getTrialName(member.signedUpCombatTrialHrid, state.guildTrialDetails, state.skillDetails) : "None";
            const activity = member.isOnline ? "Online" : member.actionType ? Core.prettifyHrid(member.actionType) : member.lastActiveAt ? `Inactive ${formatRelativeTime(member.lastActiveAt)}` : "Offline";
            return `
                <tr>
                    <td><span class="mwigm-member-name">${escapeHtml(member.name)}</span><br><span class="mwigm-subtext">${escapeHtml(Core.prettifyHrid(member.role))} · ${escapeHtml(activity)}</span>${strongest ? `<span class="mwigm-member-skills">Best: ${escapeHtml(strongest.name)} ${strongest.level}</span>` : ""}</td>
                    <td>${total ? total.level : "--"}</td>
                    <td>${formatNumber(member.experience)}</td>
                    <td>${formatNumber(member.weeklyExperience)}</td>
                    <td title="Combat: ${escapeHtml(combatTrial)}${member.signedUpCombatRoleHrid ? ` · ${escapeHtml(Core.prettifyHrid(member.signedUpCombatRoleHrid))}` : ""}">${escapeHtml(skillingTrial)}<br><span class="mwigm-subtext">${escapeHtml(combatTrial)}</span></td>
                    <td class="${profile ? "mwigm-muted" : "mwigm-missing"}">${profile ? formatRelativeTime(profile.capturedAt) : "Not viewed"}</td>
                </tr>
            `;
        }).join("");
        return `<table class="mwigm-table"><thead><tr><th style="width:27%">Member</th><th>Total</th><th>Guild XP</th><th>Weekly XP</th><th>Trials</th><th>Profile</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    function renderTrials(aggregate) {
        const analysis = currentTrialAnalysis(aggregate);
        if (!analysis.hasTrialData) {
            return emptyState("Waiting for weekly trials", "Reload the game or open Guild > Trials so the current trial set is available.");
        }

        const query = state.query.toLocaleLowerCase();
        const overview = `
            <div class="mwigm-status">
                ${metric("Skilling signed", `${analysis.skillingSignedCount}/${aggregate.memberCount}`)}
                ${metric("Combat signed", `${analysis.combatSignedCount}/${aggregate.memberCount}`)}
                ${metric("No skilling", analysis.unsignedSkilling.length)}
                ${metric("No combat", analysis.unsignedCombat.length)}
            </div>
        `;
        const skillingRows = analysis.skilling
            .filter((trial) => trial.name.toLocaleLowerCase().includes(query) || trial.signups.some((entry) => entry.memberName.toLocaleLowerCase().includes(query)))
            .map((trial) => renderTrialRow(trial, false))
            .join("");
        const combatRows = analysis.combat
            .filter((trial) => trial.name.toLocaleLowerCase().includes(query) || trial.signups.some((entry) => entry.memberName.toLocaleLowerCase().includes(query)))
            .map((trial) => renderTrialRow(trial, true))
            .join("");
        let recommendations = analysis.recommendations.filter((entry) =>
            entry.memberName.toLocaleLowerCase().includes(query) ||
            entry.currentTrialName.toLocaleLowerCase().includes(query) ||
            entry.recommendedTrialName.toLocaleLowerCase().includes(query),
        );
        if (state.sort === "gap") {
            recommendations = [...recommendations].sort((left, right) => {
                if (left.isAligned !== right.isAligned) return left.isAligned ? 1 : -1;
                const leftGap = (left.recommendedLevel || 0) - (left.currentLevel || 0);
                const rightGap = (right.recommendedLevel || 0) - (right.currentLevel || 0);
                return rightGap - leftGap || left.memberName.localeCompare(right.memberName);
            });
        }
        const recommendationRows = recommendations.map((entry) => `
            <tr>
                <td><span class="mwigm-member-name">${escapeHtml(entry.memberName)}</span><br><span class="mwigm-subtext">${escapeHtml(entry.reason)}</span></td>
                <td>${escapeHtml(entry.currentTrialName)}${Number.isFinite(entry.currentLevel) ? ` <span class="mwigm-subtext">Lv ${entry.currentLevel}</span>` : ""}</td>
                <td>${escapeHtml(entry.recommendedTrialName)} <span class="mwigm-subtext">Lv ${entry.recommendedLevel}</span></td>
                <td><span class="mwigm-chip ${entry.isAligned ? "mwigm-chip-good" : "mwigm-chip-warn"}">${entry.isAligned ? "Aligned" : "Review"}</span></td>
            </tr>
        `).join("");

        return `
            ${overview}
            <div class="mwigm-section-title">Skilling trials <span>Signup-time levels</span></div>
            <table class="mwigm-table"><thead><tr><th style="width:34%">Trial</th><th>Signed</th><th>Average</th><th>Range</th><th>Minimum</th></tr></thead><tbody>${skillingRows}</tbody></table>
            <div class="mwigm-section-title">Combat trials <span>Role mix and combat level</span></div>
            <table class="mwigm-table"><thead><tr><th style="width:34%">Trial</th><th>Signed</th><th>Average</th><th colspan="2">Roles</th></tr></thead><tbody>${combatRows}</tbody></table>
            <div class="mwigm-section-title">Skilling allocation suggestions <span>Balanced across captured profiles</span></div>
            <div class="mwigm-notice">Suggestions divide captured, eligible members across this week's skilling trials, prioritizing each member's strongest relevant skill. They are planning hints, not predictions; stale profiles, equipment, buffs, and availability are not modeled.</div>
            <table class="mwigm-table"><thead><tr><th style="width:34%">Member</th><th>Current</th><th>Suggested</th><th>Status</th></tr></thead><tbody>${recommendationRows}</tbody></table>
        `;
    }

    function renderTrialRow(trial, isCombat) {
        const memberNames = trial.signups.map((entry) => `${entry.memberName}${Number.isFinite(entry.level) ? ` (${entry.level})` : ""}`).join(", ") || "No signups";
        const range = Number.isFinite(trial.minSignupLevel) ? `${trial.minSignupLevel}-${trial.maxSignupLevel}` : "--";
        const roles = Object.entries(trial.roles).map(([role, count]) => `${Core.prettifyHrid(role)} ${count}`).join(", ") || "--";
        return `
            <tr title="${escapeHtml(memberNames)}">
                <td><span class="mwigm-trial-name">${escapeHtml(trial.name)}</span><br><span class="mwigm-subtext">${escapeHtml(trial.trialHrid)}</span></td>
                <td>${trial.signupCount}</td>
                <td>${Number.isFinite(trial.averageLevel) ? trial.averageLevel.toFixed(1) : "--"}</td>
                ${isCombat ? `<td colspan="2">${escapeHtml(roles)}</td>` : `<td>${range}</td><td>${trial.minLevel || "--"}</td>`}
            </tr>
        `;
    }

    function renderMissing(aggregate) {
        if (!aggregate.missingMembers.length) {
            return emptyState("Full coverage", "Every current guild member has a cached profile.");
        }
        const query = state.query.toLocaleLowerCase();
        const members = aggregate.missingMembers.filter((member) => member.name.toLocaleLowerCase().includes(query));
        return `
            <div class="mwigm-notice">Open these members' profiles from the game's Guild panel. The monitor captures the response passively; it never clicks or requests profiles for you.</div>
            <ul class="mwigm-list">${members.map((member) => `<li><span><strong>${escapeHtml(member.name)}</strong><br><span class="mwigm-subtext">${escapeHtml(Core.prettifyHrid(member.role))}</span></span><span class="mwigm-missing">Needed</span></li>`).join("")}</ul>
        `;
    }

    function coverageNotice(aggregate) {
        if (aggregate.coveredCount === aggregate.memberCount) return "";
        return `<div class="mwigm-notice">Statistics currently use ${aggregate.coveredCount} of ${aggregate.memberCount} members. Open the Missing profiles tab for the remaining names.</div>`;
    }

    function emptyState(title, detail) {
        return `<div class="mwigm-empty"><strong>${escapeHtml(title)}</strong>${escapeHtml(detail)}</div>`;
    }

    function sortSkills(skills) {
        const copy = [...skills];
        if (state.sort === "average") return copy.sort((a, b) => b.average - a.average || a.name.localeCompare(b.name));
        if (state.sort === "max") return copy.sort((a, b) => b.maxLevel - a.maxLevel || a.name.localeCompare(b.name));
        if (state.sort === "min") return copy.sort((a, b) => a.minLevel - b.minLevel || a.name.localeCompare(b.name));
        return copy.sort((a, b) => {
            if (a.skillHrid === Core.TOTAL_LEVEL_HRID) return -1;
            if (b.skillHrid === Core.TOTAL_LEVEL_HRID) return 1;
            return a.name.localeCompare(b.name);
        });
    }

    function sortMembers(members) {
        const copy = [...members];
        if (state.sort === "total") {
            return copy.sort((a, b) => getTotalLevel(b) - getTotalLevel(a) || a.name.localeCompare(b.name));
        }
        if (state.sort === "freshness") {
            return copy.sort((a, b) => (a.profile ? a.profile.capturedAt : 0) - (b.profile ? b.profile.capturedAt : 0));
        }
        return copy.sort((a, b) => a.name.localeCompare(b.name));
    }

    function getTotalLevel(member) {
        if (!member.profile) return -1;
        const total = member.profile.skills.find((skill) => skill.skillHrid === Core.TOTAL_LEVEL_HRID);
        return total ? total.level : -1;
    }

    function handlePanelClick(event) {
        const control = event.target.closest("[data-action], [data-tab]");
        if (!control) return;

        if (control.dataset.tab) {
            state.activeTab = control.dataset.tab;
            state.query = "";
            state.sort = "name";
            render();
            return;
        }

        switch (control.dataset.action) {
            case "close":
                state.isOpen = false;
                render();
                break;
            case "snapshot":
                saveSnapshot();
                break;
            case "export":
                exportCsv();
                break;
        }
    }

    function handlePanelInput(event) {
        if (event.target.dataset.control === "query") {
            state.query = event.target.value;
            queueRender();
        }
        if (event.target.dataset.control === "sort") {
            state.sort = event.target.value;
            render();
        }
    }

    function saveSnapshot() {
        if (!state.guild) return;
        const aggregate = currentAggregate();
        if (!aggregate.coveredCount) return;
        const { store, key } = ensureGuildStore();
        store.guilds[key].snapshots.push(Core.makeSnapshot(state.guild, aggregate, Date.now(), currentTrialAnalysis(aggregate)));
        store.guilds[key].snapshots = store.guilds[key].snapshots.slice(-60);
        writeStore(store);
        state.guildStore = store.guilds[key];
        render();
    }

    function exportCsv() {
        const aggregate = currentAggregate();
        if (!aggregate.coveredCount) return;
        const csv = Core.toCsv(aggregate, state.skillDetails, state.guildTrialDetails);
        const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${slugify(state.guild && state.guild.name ? state.guild.name : "guild")}-skills-${new Date().toISOString().slice(0, 10)}.csv`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function queueRender() {
        if (state.renderQueued) return;
        state.renderQueued = true;
        requestAnimationFrame(() => {
            state.renderQueued = false;
            render();
        });
    }

    function withSelectedOption(options, selected) {
        return options.replace(`value="${selected}"`, `value="${selected}" selected`);
    }

    function formatPercent(value) {
        return `${Math.round((Number(value) || 0) * 100)}%`;
    }

    function formatNumber(value) {
        return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(Number(value) || 0);
    }

    function formatDelta(value) {
        if (value === null || !Number.isFinite(value)) return "--";
        if (Math.abs(value) < 0.05) return "0.0";
        return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
    }

    function formatRelativeTime(timestamp) {
        const elapsed = Date.now() - Number(timestamp || 0);
        if (elapsed < 60_000) return "Just now";
        if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
        if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
        return `${Math.floor(elapsed / 86_400_000)}d ago`;
    }

    function slugify(value) {
        return String(value || "guild").toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "guild";
    }

    function escapeHtml(value) {
        return String(value === null || value === undefined ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    installWebSocketObserver();
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", createShell, { once: true });
    } else {
        createShell();
    }
}
