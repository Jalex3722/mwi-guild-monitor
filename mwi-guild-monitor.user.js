// ==UserScript==
// @name         MWI Guild Monitor
// @namespace    https://github.com/local/mwi-guild-monitor
// @version      0.8.5
// @description  Read-only guild, trial, shrine, and market analytics for Milky Way Idle leaders and officers.
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
    const SKILL_THRESHOLDS = [100, 125, 150];
    const DAY_MS = 86_400_000;
    const WEEK_MS = 7 * DAY_MS;
    const AURA_DEFINITIONS = [
        { hrid: "/abilities/speed_aura", name: "Speed Aura", scalingSkillHrid: "/skills/attack" },
        { hrid: "/abilities/guardian_aura", name: "Guardian Aura", scalingSkillHrid: "/skills/defense" },
        { hrid: "/abilities/fierce_aura", name: "Fierce Aura", scalingSkillHrid: "/skills/melee" },
        { hrid: "/abilities/critical_aura", name: "Critical Aura", scalingSkillHrid: "/skills/ranged" },
        { hrid: "/abilities/mystic_aura", name: "Mystic Aura", scalingSkillHrid: "/skills/magic" },
    ];

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

    function median(values) {
        const sorted = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
        if (!sorted.length) return null;
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
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
                const thresholdCounts = Object.fromEntries(SKILL_THRESHOLDS.map((threshold) => {
                    const members = entries
                        .filter((entry) => entry.level > threshold)
                        .sort((left, right) => right.level - left.level || left.memberName.localeCompare(right.memberName));
                    return [threshold, {
                        count: members.length,
                        members: members.map((entry) => ({
                            memberId: entry.memberId,
                            memberName: entry.memberName,
                            level: entry.level,
                        })),
                    }];
                }));

                return {
                    skillHrid,
                    name: getSkillName(skillHrid, skillDetails),
                    average: entries.length ? total / entries.length : 0,
                    median: median(entries.map((entry) => entry.level)),
                    minLevel,
                    maxLevel,
                    minMembers,
                    maxMembers,
                    thresholdCounts,
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
        return midnightUtc - ((date.getUTCDay() - 5 + 7) % 7) * DAY_MS;
    }

    function resolveGuildWeekStart(guild, now = Date.now()) {
        const value = firstDefined(guild, ["currentWeekStartAt", "weekStartAt", "trialWeekStartAt"], null);
        return toTimestamp(value) ?? currentGuildWeekStart(now);
    }

    function isCurrentSignup(member, guildWeekStartAt, now = Date.now()) {
        if (!member || !member.signupWeekStartAt) return true;
        const signupStart = toTimestamp(member.signupWeekStartAt);
        const guildStart = toTimestamp(guildWeekStartAt);
        if (signupStart === null) return true;
        if (guildStart !== null) return signupStart === guildStart;
        return signupStart === currentGuildWeekStart(now);
    }

    function getOfflineDurationMs(member, now = Date.now()) {
        if (!member || member.isOnline || member.hideOnlineStatus) return null;
        const lastActiveAt = toTimestamp(member.lastActiveAt);
        if (lastActiveAt === null || lastActiveAt > now) return null;
        return now - lastActiveAt;
    }

    function recordWeeklyTrialParticipation(history, aggregate, weekStartAt, observedAt = Date.now()) {
        const normalizedHistory = { ...asObject(history) };
        const weekStart = toTimestamp(weekStartAt) ?? currentGuildWeekStart(observedAt);
        const key = String(weekStart);
        const previous = asObject(normalizedHistory[key]);
        const previousMembers = asObject(previous.members);
        const members = { ...previousMembers };

        aggregate.members.forEach((member) => {
            const active = isCurrentSignup(member, weekStart, observedAt);
            members[String(member.id)] = {
                memberName: member.name,
                signedSkilling: active && Boolean(member.signedUpSkillingTrialHrid),
                signedCombat: active && Boolean(member.signedUpCombatTrialHrid),
                observedAt,
            };
        });

        normalizedHistory[key] = {
            weekStartAt: weekStart,
            observedAt,
            members,
        };

        return Object.fromEntries(Object.entries(normalizedHistory)
            .sort(([left], [right]) => Number(left) - Number(right))
            .slice(-12));
    }

    function getPreviousWeekTrialStatus(history, currentWeekStartAt, memberId) {
        const currentWeekStart = toTimestamp(currentWeekStartAt);
        if (currentWeekStart === null) return "unknown";
        const previousWeekStart = currentWeekStart - WEEK_MS;
        const previousWeek = asObject(history)[String(previousWeekStart)];
        const member = previousWeek && asObject(previousWeek.members)[String(memberId)];
        if (!member) return "unknown";
        if (member.signedSkilling || member.signedCombat) return "participated";
        const lastObservedAt = toTimestamp(member.observedAt ?? previousWeek.observedAt);
        return lastObservedAt !== null && lastObservedAt >= previousWeekStart + 6 * DAY_MS ? "missed" : "unknown";
    }

    function buildMemberTracking(aggregate, history = {}, currentWeekStartAt = null, now = Date.now()) {
        const weekStart = toTimestamp(currentWeekStartAt) ?? currentGuildWeekStart(now);
        return aggregate.members.map((member) => {
            const offlineDurationMs = getOfflineDurationMs(member, now);
            return {
                memberId: member.id,
                memberName: member.name,
                offlineDurationMs,
                offlineThreeDays: offlineDurationMs !== null && offlineDurationMs >= 3 * DAY_MS,
                previousWeekStatus: getPreviousWeekTrialStatus(history, weekStart, member.id),
            };
        });
    }

    function positiveNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : 0;
    }

    function getItemName(itemHrid, itemDetails = {}) {
        const detail = asObject(itemDetails)[itemHrid] || {};
        return detail.name || detail.displayName || prettifyHrid(itemHrid);
    }

    function getMarketLevelRecord(marketData, itemHrid) {
        const root = asObject(marketData);
        const records = asObject((root.marketData || root)[itemHrid]);
        return records[0] || records["0"] || null;
    }

    function getMarketItemValue(marketItemValues, itemHrid) {
        const records = asObject(asObject(marketItemValues)[itemHrid]);
        return positiveNumber(records[0] ?? records["0"]);
    }

    function getMarketQuote(itemHrid, marketData = {}, marketItemValues = {}) {
        const record = getMarketLevelRecord(marketData, itemHrid) || {};
        const ask = positiveNumber(record.a ?? record.ask);
        const bid = positiveNumber(record.b ?? record.bid);
        const fair = positiveNumber(record.p ?? record.averagePrice) || getMarketItemValue(marketItemValues, itemHrid);
        const unitPrice = ask || fair || bid;
        return {
            ask,
            bid,
            fair,
            unitPrice,
            source: ask ? "ask" : fair ? "fair" : bid ? "bid" : "unavailable",
        };
    }

    function getGuildBuffLevel(guildBuffLevels, guildBuffHrid) {
        const record = asObject(guildBuffLevels)[guildBuffHrid];
        const value = record && typeof record === "object" ? record.level ?? record.currentLevel : record;
        const level = Number(value);
        return Number.isSafeInteger(level) && level > 0 ? level : 0;
    }

    function extractGuildBuffLevels(payload, existing = {}) {
        const preferredKeys = ["characterGuildBuffMap", "characterGuildBuffDict", "characterGuildBuffs", "characterGuildBuffLevelMap", "characterGuildBuffLevelDict"];
        const fallbackKeys = ["guildBuffLevelMap", "guildBuffLevelDict", "guildBuffLevels", "guildBuffMap", "guildBuffDict"];
        const preferred = [];
        const fallback = [];
        const pending = [{ value: payload, depth: 0 }];
        const visited = new Set();
        let scanned = 0;

        while (pending.length && scanned < 400) {
            const { value, depth } = pending.pop();
            if (!value || typeof value !== "object" || visited.has(value) || depth > 6) continue;
            visited.add(value);
            scanned += 1;
            preferredKeys.forEach((key) => {
                if (value[key] && typeof value[key] === "object") preferred.push(value[key]);
            });
            fallbackKeys.forEach((key) => {
                if (value[key] && typeof value[key] === "object") fallback.push(value[key]);
            });
            Object.values(value).forEach((child) => {
                if (child && typeof child === "object") pending.push({ value: child, depth: depth + 1 });
            });
        }

        return [...fallback, ...preferred].reduce((levels, candidate) => {
            const entries = Array.isArray(candidate)
                ? candidate.map((record, index) => [record && (record.guildBuffHrid || record.hrid) || String(index), record])
                : Object.entries(candidate);
            entries.forEach(([hrid, record]) => {
                if (hrid) levels[hrid] = record;
            });
            return levels;
        }, { ...asObject(existing) });
    }

    function extractEconomyDefinitions(payload) {
        const pending = [payload];
        const visited = new Set();
        let itemDetails = {};
        let guildBuffDetails = {};

        while (pending.length && visited.size < 24) {
            const raw = pending.shift();
            const value = typeof raw === "string" ? parseJsonObject(raw) : asObject(raw);
            if (!Object.keys(value).length || visited.has(value)) continue;
            visited.add(value);
            const itemMap = asObject(value.itemDetailMap);
            const buffMap = asObject(value.guildBuffDetailMap);
            const items = Object.keys(itemMap).length ? itemMap : asObject(value.itemDetailDict);
            const buffs = Object.keys(buffMap).length ? buffMap : asObject(value.guildBuffDetailDict);
            if (Object.keys(items).length) itemDetails = items;
            if (Object.keys(buffs).length) guildBuffDetails = buffs;
            ["data", "payload", "message", "initClientData", "clientData", "gameData"].forEach((key) => {
                if (value[key]) pending.push(value[key]);
            });
        }

        return { itemDetails, guildBuffDetails };
    }

    function analyzeGuildEconomy({
        itemDetails = {},
        guildBuffDetails = {},
        guildBuffLevels = {},
        marketData = {},
        marketItemValues = {},
    } = {}) {
        const creditGroups = new Map();
        const guildTokenRoutes = [];
        const details = asObject(itemDetails);

        Object.entries(details).forEach(([fallbackHrid, rawDetail]) => {
            const detail = rawDetail || {};
            const itemHrid = detail.hrid || detail.itemHrid || fallbackHrid;
            const conversions = Array.isArray(detail.guildCreditConversions) ? detail.guildCreditConversions : [];
            conversions.forEach((conversion) => {
                const creditHrid = conversion && conversion.creditItemHrid;
                const creditCount = positiveNumber(conversion && conversion.creditCount);
                if (!creditHrid || !creditCount) return;
                if (!creditGroups.has(creditHrid)) {
                    creditGroups.set(creditHrid, {
                        creditHrid,
                        creditName: getItemName(creditHrid, details),
                        options: [],
                    });
                }

                if (itemHrid === "/items/guild_token") {
                    const guildTokenCount = positiveNumber(conversion.guildTokenCount ?? conversion.itemCount);
                    if (guildTokenCount) guildTokenRoutes.push({ creditHrid, creditCount, guildTokenCount });
                    return;
                }

                const itemCount = positiveNumber(conversion.itemCount);
                if (!itemCount) return;
                const quote = getMarketQuote(itemHrid, marketData, marketItemValues);
                creditGroups.get(creditHrid).options.push({
                    itemHrid,
                    itemName: getItemName(itemHrid, details),
                    itemCount,
                    creditCount,
                    ...quote,
                    available: quote.unitPrice > 0,
                    totalCost: quote.unitPrice > 0 ? quote.unitPrice * itemCount : null,
                    costPerCredit: quote.unitPrice > 0 ? quote.unitPrice * itemCount / creditCount : null,
                });
            });
        });

        const credits = [...creditGroups.values()].map((group) => {
            group.options.sort((left, right) => {
                if (left.available !== right.available) return left.available ? -1 : 1;
                return (left.costPerCredit ?? Number.POSITIVE_INFINITY) - (right.costPerCredit ?? Number.POSITIVE_INFINITY) || left.itemName.localeCompare(right.itemName);
            });
            return { ...group, bestOption: group.options.find((option) => option.available) || null };
        }).sort((left, right) => left.creditName.localeCompare(right.creditName));

        const creditValues = Object.fromEntries(credits.map((group) => [group.creditHrid, group.bestOption ? group.bestOption.costPerCredit : null]));
        const valuedTokenRoutes = guildTokenRoutes.map((route) => {
            const creditValue = creditValues[route.creditHrid];
            return {
                ...route,
                creditName: getItemName(route.creditHrid, details),
                valuePerGuildToken: Number.isFinite(creditValue) ? creditValue * route.creditCount / route.guildTokenCount : null,
            };
        }).sort((left, right) => (right.valuePerGuildToken ?? -1) - (left.valuePerGuildToken ?? -1));
        const guildTokenValue = valuedTokenRoutes.find((route) => Number.isFinite(route.valuePerGuildToken))?.valuePerGuildToken ?? null;

        const shrines = Object.entries(asObject(guildBuffDetails)).map(([fallbackHrid, rawDetail]) => {
            const detail = rawDetail || {};
            const guildBuffHrid = detail.guildBuffHrid || detail.hrid || fallbackHrid;
            const linkedShrineHrid = [detail.guildShrineHrid, detail.shrineHrid, detail.guildBuildingHrid]
                .find((hrid) => typeof hrid === "string" && hrid.startsWith("/guild_shrines/"));
            const shrineTypeHrid = linkedShrineHrid || `/guild_shrines/${String(guildBuffHrid).split("/").pop().replace(/_(combat|skilling)$/, "")}`;
            const currentLevel = getGuildBuffLevel(guildBuffLevels, guildBuffHrid);
            let cumulativeCost = 0;
            let cumulativeKnown = true;
            const levels = Object.entries(detail.levelCosts || {})
                .map(([levelKey, cost]) => ({ level: Number(levelKey), cost }))
                .filter((entry) => Number.isSafeInteger(entry.level) && entry.level > 0 && entry.cost)
                .sort((left, right) => left.level - right.level)
                .map(({ level, cost }) => {
                    const guildTokenCost = positiveNumber(cost.guildTokenCost);
                    const creditCosts = (Array.isArray(cost.creditCosts) ? cost.creditCosts : []).map((creditCost) => {
                        const count = positiveNumber(creditCost && creditCost.count);
                        const itemHrid = creditCost && creditCost.itemHrid;
                        const unitCoinCost = itemHrid ? creditValues[itemHrid] : null;
                        return {
                            itemHrid,
                            itemName: getItemName(itemHrid, details),
                            count,
                            unitCoinCost,
                            coinCost: count && Number.isFinite(unitCoinCost) ? count * unitCoinCost : null,
                        };
                    }).filter((entry) => entry.count);
                    const guildTokenCoinCost = guildTokenCost && Number.isFinite(guildTokenValue) ? guildTokenCost * guildTokenValue : guildTokenCost ? null : 0;
                    const components = [guildTokenCoinCost, ...creditCosts.map((entry) => entry.coinCost)];
                    const known = components.every(Number.isFinite);
                    const incrementalCost = known ? components.reduce((sum, value) => sum + value, 0) : null;
                    if (cumulativeKnown && known) cumulativeCost += incrementalCost;
                    else cumulativeKnown = false;
                    return {
                        level,
                        guildTokenCost,
                        guildTokenCoinCost,
                        creditCosts,
                        incrementalCost,
                        cumulativeCost: cumulativeKnown ? cumulativeCost : null,
                        purchased: level <= currentLevel,
                    };
                });
            return {
                guildBuffHrid,
                shrineTypeHrid,
                shrineTypeName: `${prettifyHrid(shrineTypeHrid)} Shrine`,
                name: detail.name || detail.displayName || prettifyHrid(guildBuffHrid),
                isCombat: Boolean(detail.isCombat) || /_combat$/.test(guildBuffHrid),
                currentLevel,
                levels,
            };
        }).filter((shrine) => shrine.levels.length)
            .sort((left, right) => Number(right.isCombat) - Number(left.isCombat) || left.name.localeCompare(right.name));
        const groupMap = new Map();
        shrines.forEach((shrine) => {
            if (!groupMap.has(shrine.shrineTypeHrid)) {
                groupMap.set(shrine.shrineTypeHrid, {
                    shrineTypeHrid: shrine.shrineTypeHrid,
                    name: shrine.shrineTypeName,
                    buffs: [],
                });
            }
            groupMap.get(shrine.shrineTypeHrid).buffs.push(shrine);
        });
        const shrineGroups = [...groupMap.values()]
            .map((group) => ({
                ...group,
                levelCount: group.buffs.reduce((sum, buff) => sum + buff.levels.length, 0),
                pricedLevelCount: group.buffs.flatMap((buff) => buff.levels).filter((level) => Number.isFinite(level.incrementalCost)).length,
            }))
            .sort((left, right) => left.name.localeCompare(right.name));

        return {
            credits,
            creditValues,
            guildTokenRoutes: valuedTokenRoutes,
            guildTokenValue,
            shrines,
            shrineGroups,
            pricedLevelCount: shrines.flatMap((shrine) => shrine.levels).filter((level) => Number.isFinite(level.incrementalCost)).length,
            levelCount: shrines.reduce((sum, shrine) => sum + shrine.levels.length, 0),
        };
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

    function getAuraDefinition(auraHrid) {
        return AURA_DEFINITIONS.find((aura) => aura.hrid === auraHrid) || null;
    }

    function getAuraAssignment(auraAssignments, memberId) {
        const assignment = asObject(auraAssignments)[String(memberId)];
        if (typeof assignment === "string") return assignment;
        return assignment && typeof assignment.auraHrid === "string" ? assignment.auraHrid : "";
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
        auraAssignments = {},
        now = Date.now(),
    }) {
        const skillingHrids = Array.isArray(weeklyTrialSet.skillHrids) ? weeklyTrialSet.skillHrids : [];
        const combatHrids = Array.isArray(weeklyTrialSet.combatHrids) ? weeklyTrialSet.combatHrids : [];
        const minimums = parseJsonObject(trialMinLevels);
        const currentMembers = aggregate.members.map((member) => {
            const active = isCurrentSignup(member, guildWeekStartAt, now);
            return {
                ...member,
                desiredAuraHrid: getAuraAssignment(auraAssignments, member.id),
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
            const auraCoverage = kind === "combat" ? AURA_DEFINITIONS.map((aura) => {
                const assignedMembers = signups.filter((entry) => {
                    const member = currentMembers.find((candidate) => candidate.id === entry.memberId);
                    return member && member.desiredAuraHrid === aura.hrid;
                });
                return {
                    ...aura,
                    members: assignedMembers,
                    count: assignedMembers.length,
                    status: assignedMembers.length === 0 ? "missing" : assignedMembers.length === 1 ? "covered" : "duplicate",
                };
            }) : [];

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
                auraCoverage,
                auraCoveredCount: auraCoverage.filter((aura) => aura.status === "covered").length,
                auraIssueCount: auraCoverage.filter((aura) => aura.status !== "covered").length,
            };
        };

        const skilling = skillingHrids.map((hrid) => makeTrial(hrid, "skilling"));
        const combat = combatHrids.map((hrid) => makeTrial(hrid, "combat"));
        const signedMemberIds = new Set(skilling.flatMap((trial) => trial.signups.map((entry) => String(entry.memberId))));
        const signedMembers = currentMembers.filter((member) => signedMemberIds.has(String(member.id)));
        const recommendations = buildSkillingRecommendations(signedMembers, skilling, aggregate.skills);
        const medianSuggestions = buildMedianTrialSuggestions(currentMembers, skilling, aggregate.skills);
        const memberById = new Map(currentMembers.map((member) => [String(member.id), member]));
        const assessedMemberIds = new Set(recommendations.map((entry) => String(entry.memberId)));
        const optimalDistribution = skilling.map((trial) => {
            const heldAssignments = trial.signups.filter((entry) => !assessedMemberIds.has(String(entry.memberId))).map((entry) => {
                const member = memberById.get(String(entry.memberId));
                return {
                    memberId: entry.memberId,
                    memberName: entry.memberName,
                    currentTrialHrid: trial.trialHrid,
                    recommendedTrialHrid: trial.trialHrid,
                    recommendedLevel: getProfileSkillLevel(member, trial.skillHrid),
                    signupStatus: "unassessed",
                    hasProfile: Boolean(member && member.profile && member.profile.skills.length),
                };
            });
            const assignments = [...recommendations.filter((entry) => entry.recommendedTrialHrid === trial.trialHrid), ...heldAssignments]
                .sort((left, right) => left.memberName.localeCompare(right.memberName));
            const actualProfileLevels = trial.signups.map((entry) => getProfileSkillLevel(memberById.get(String(entry.memberId)), trial.skillHrid)).filter(Number.isFinite);
            const targetProfileLevels = assignments.map((entry) => entry.recommendedLevel).filter(Number.isFinite);
            return {
                trialHrid: trial.trialHrid,
                trialName: trial.name,
                assignments,
                actualSignups: trial.signups,
                actualProfileCount: actualProfileLevels.length,
                actualAverageLevel: actualProfileLevels.length ? actualProfileLevels.reduce((sum, level) => sum + level, 0) / actualProfileLevels.length : null,
                targetProfileCount: targetProfileLevels.length,
                targetAverageLevel: targetProfileLevels.length ? targetProfileLevels.reduce((sum, level) => sum + level, 0) / targetProfileLevels.length : null,
                unassessedCount: heldAssignments.length,
                aligned: assignments.filter((entry) => entry.signupStatus === "aligned"),
                signedElsewhere: assignments.filter((entry) => entry.signupStatus === "different"),
            };
        });
        const highLevelSkillGaps = skilling.map((trial) => ({
            trialHrid: trial.trialHrid,
            trialName: trial.name,
            skillHrid: trial.skillHrid,
            members: currentMembers
                .map((member) => ({
                    memberId: member.id,
                    memberName: member.name,
                    level: getProfileSkillLevel(member, trial.skillHrid),
                    currentSkillingTrialHrid: member.currentSkillingTrialHrid,
                }))
                .filter((member) => Number.isFinite(member.level) && member.level > 125 && member.currentSkillingTrialHrid !== trial.trialHrid)
                .sort((left, right) => right.level - left.level || left.memberName.localeCompare(right.memberName)),
        }));
        const auraTracking = currentMembers
            .filter((member) => member.desiredAuraHrid)
            .map((member) => {
                const aura = getAuraDefinition(member.desiredAuraHrid);
                const trial = combat.find((entry) => entry.trialHrid === member.currentCombatTrialHrid) || null;
                const coverage = trial && trial.auraCoverage.find((entry) => entry.hrid === member.desiredAuraHrid);
                return {
                    memberId: member.id,
                    memberName: member.name,
                    auraHrid: member.desiredAuraHrid,
                    auraName: aura ? aura.name : prettifyHrid(member.desiredAuraHrid),
                    scalingSkillHrid: aura ? aura.scalingSkillHrid : "",
                    scalingLevel: aura ? getProfileSkillLevel(member, aura.scalingSkillHrid) : null,
                    combatTrialHrid: member.currentCombatTrialHrid,
                    combatTrialName: trial ? trial.name : "Not signed up",
                    status: !trial ? "unsigned" : coverage && coverage.status === "duplicate" ? "duplicate" : "covered",
                };
            })
            .sort((left, right) => left.auraName.localeCompare(right.auraName) || left.memberName.localeCompare(right.memberName));

        return {
            hasTrialData: skilling.length > 0 || combat.length > 0,
            skilling,
            combat,
            recommendations,
            medianSuggestions,
            optimalDistribution,
            allocationBalanced: optimalDistribution.length < 2 || Math.max(...optimalDistribution.map((trial) => trial.assignments.length)) - Math.min(...optimalDistribution.map((trial) => trial.assignments.length)) <= 1,
            highLevelSkillGaps,
            auraTracking,
            skillingSignedCount: currentMembers.filter((member) => member.currentSkillingTrialHrid).length,
            combatSignedCount: currentMembers.filter((member) => member.currentCombatTrialHrid).length,
            anyTrialSignedCount: currentMembers.filter((member) => member.currentSkillingTrialHrid || member.currentCombatTrialHrid).length,
            unsignedTrials: currentMembers.filter((member) => !member.currentSkillingTrialHrid && !member.currentCombatTrialHrid),
        };
    }

    function buildSkillingRecommendations(members, trials, aggregateSkills = []) {
        if (!trials.length) return [];
        const medianBySkill = new Map(aggregateSkills.map((skill) => [skill.skillHrid, skill.median]));
        const candidates = members
            .map((member) => {
                const options = trials
                    .map((trial) => ({
                        trial,
                        level: getProfileSkillLevel(member, trial.skillHrid),
                        guildMedian: medianBySkill.get(trial.skillHrid),
                    }))
                    .filter((option) => Number.isFinite(option.level) && (trialAllowsLevel(option.trial, option.level)));
                options.forEach((option) => {
                    option.medianDifference = Number.isFinite(option.guildMedian) ? option.level - option.guildMedian : option.level;
                });
                options.sort((left, right) => right.medianDifference - left.medianDifference || right.level - left.level || left.trial.name.localeCompare(right.trial.name));
                return { member, options, specialization: options.length > 1 ? options[0].medianDifference - options[1].medianDifference : options.length ? options[0].medianDifference : -1 };
            })
            .filter((candidate) => candidate.options.length)
            .sort((left, right) => left.options.length - right.options.length || right.specialization - left.specialization || left.member.name.localeCompare(right.member.name));

        if (!candidates.length) return [];
        const candidateIds = new Set(candidates.map((candidate) => String(candidate.member.id)));
        const fixedMembers = members.filter((member) => !candidateIds.has(String(member.id)));
        const fixedCounts = Object.fromEntries(trials.map((trial) => [trial.trialHrid, fixedMembers.filter((member) =>
            member.currentSkillingTrialHrid === trial.trialHrid).length]));
        const fixedScores = Object.fromEntries(trials.map((trial) => [trial.trialHrid, fixedMembers
            .filter((member) => member.currentSkillingTrialHrid === trial.trialHrid)
            .reduce((sum, member) => {
                const level = getProfileSkillLevel(member, trial.skillHrid);
                if (!Number.isFinite(level)) return sum;
                const guildMedian = medianBySkill.get(trial.skillHrid);
                return sum + level - (Number.isFinite(guildMedian) ? guildMedian : 0);
            }, 0)]));
        const minPerTrial = Math.floor(members.length / trials.length);
        const maxPerTrial = Math.ceil(members.length / trials.length);
        const extraSlots = members.length % trials.length;
        let bestPlan = null;

        function considerQuotas(index, extrasLeft, quotas) {
            if (index === trials.length) {
                if (extrasLeft) return;
                const candidateQuotas = quotas.map((total, trialIndex) => total - fixedCounts[trials[trialIndex].trialHrid]);
                if (candidateQuotas.some((count) => count < 0)) return;
                const plan = solveBalancedTrialAssignment(candidates, trials, candidateQuotas, quotas);
                if (!plan) return;
                const fixedScore = trials.reduce((sum, trial, trialIndex) => sum +
                    (quotas[trialIndex] ? fixedScores[trial.trialHrid] / quotas[trialIndex] : 0), 0);
                const score = plan.score + fixedScore;
                if (!bestPlan || score > bestPlan.score + 1e-9 ||
                    (Math.abs(score - bestPlan.score) <= 1e-9 && plan.alignedCount > bestPlan.alignedCount)) {
                    bestPlan = { ...plan, score };
                }
                return;
            }
            quotas[index] = minPerTrial;
            considerQuotas(index + 1, extrasLeft, quotas);
            if (extrasLeft) {
                quotas[index] = maxPerTrial;
                considerQuotas(index + 1, extrasLeft - 1, quotas);
            }
        }

        considerQuotas(0, extraSlots, []);
        const recommendedCounts = { ...fixedCounts };
        const chosenOptions = bestPlan ? bestPlan.options : candidates.map((candidate) => {
            const option = candidate.options.find((entry) => recommendedCounts[entry.trial.trialHrid] < minPerTrial) ||
                candidate.options.find((entry) => recommendedCounts[entry.trial.trialHrid] < maxPerTrial) ||
                candidate.options[0];
            recommendedCounts[option.trial.trialHrid] += 1;
            return option;
        });

        const assignments = candidates.map((candidate, index) => {
            const option = chosenOptions[index];
            const currentHrid = candidate.member.currentSkillingTrialHrid;
            const currentTrial = trials.find((trial) => trial.trialHrid === currentHrid) || null;
            const currentLevel = currentTrial ? getProfileSkillLevel(candidate.member, currentTrial.skillHrid) : null;
            const isAligned = currentHrid === option.trial.trialHrid;
            const signupStatus = isAligned ? "aligned" : "different";
            let reason = bestPlan ? "Globally optimized balanced assignment" : "Eligibility-constrained fallback";
            if (!isAligned) {
                reason = `Signed for ${currentTrial ? currentTrial.name : "another trial"}; target is ${option.trial.name}`;
            }

            return {
                memberId: candidate.member.id,
                memberName: candidate.member.name,
                currentTrialHrid: currentHrid,
                currentTrialName: currentTrial ? currentTrial.name : "Not signed up",
                currentLevel,
                recommendedTrialHrid: option.trial.trialHrid,
                recommendedTrialName: option.trial.name,
                recommendedLevel: option.level,
                recommendedGuildMedian: option.guildMedian,
                medianDifference: option.medianDifference,
                isAligned,
                signupStatus,
                reason,
            };
        });

        return assignments.sort((left, right) => {
            if (left.isAligned !== right.isAligned) return left.isAligned ? 1 : -1;
            return left.memberName.localeCompare(right.memberName);
        });
    }

    function solveBalancedTrialAssignment(candidates, trials, quotas, totalQuotas = quotas) {
        const slots = trials.flatMap((trial, index) => Array(quotas[index]).fill(trial.trialHrid));
        const size = candidates.length;
        const unavailableCost = 1_000_000;
        const quotaByTrial = new Map(trials.map((trial, index) => [trial.trialHrid, totalQuotas[index]]));
        const optionMaps = candidates.map((candidate) => new Map(candidate.options.map((option) => [option.trial.trialHrid, option])));
        const costs = optionMaps.map((options) => slots.map((trialHrid) => {
            const option = options.get(trialHrid);
            if (!option) return unavailableCost;
            return -option.medianDifference / quotaByTrial.get(trialHrid);
        }));
        const rowPotentials = Array(size + 1).fill(0);
        const columnPotentials = Array(size + 1).fill(0);
        const matchedRows = Array(size + 1).fill(0);
        const previousColumns = Array(size + 1).fill(0);

        for (let row = 1; row <= size; row += 1) {
            matchedRows[0] = row;
            const minimumCosts = Array(size + 1).fill(Infinity);
            const used = Array(size + 1).fill(false);
            let column = 0;
            do {
                used[column] = true;
                const activeRow = matchedRows[column];
                let adjustment = Infinity;
                let nextColumn = 0;
                for (let candidateColumn = 1; candidateColumn <= size; candidateColumn += 1) {
                    if (used[candidateColumn]) continue;
                    const reducedCost = costs[activeRow - 1][candidateColumn - 1] - rowPotentials[activeRow] - columnPotentials[candidateColumn];
                    if (reducedCost < minimumCosts[candidateColumn]) {
                        minimumCosts[candidateColumn] = reducedCost;
                        previousColumns[candidateColumn] = column;
                    }
                    if (minimumCosts[candidateColumn] < adjustment) {
                        adjustment = minimumCosts[candidateColumn];
                        nextColumn = candidateColumn;
                    }
                }
                for (let candidateColumn = 0; candidateColumn <= size; candidateColumn += 1) {
                    if (used[candidateColumn]) {
                        rowPotentials[matchedRows[candidateColumn]] += adjustment;
                        columnPotentials[candidateColumn] -= adjustment;
                    } else {
                        minimumCosts[candidateColumn] -= adjustment;
                    }
                }
                column = nextColumn;
            } while (matchedRows[column]);
            do {
                const previous = previousColumns[column];
                matchedRows[column] = matchedRows[previous];
                column = previous;
            } while (column);
        }

        const chosen = Array(size);
        for (let column = 1; column <= size; column += 1) {
            const row = matchedRows[column] - 1;
            if (costs[row][column - 1] === unavailableCost) return null;
            chosen[row] = optionMaps[row].get(slots[column - 1]);
        }
        return {
            options: chosen,
            score: chosen.reduce((sum, option) => sum + option.medianDifference / quotaByTrial.get(option.trial.trialHrid), 0),
            alignedCount: chosen.filter((option, index) => option.trial.trialHrid === candidates[index].member.currentSkillingTrialHrid).length,
        };
    }

    function buildMedianTrialSuggestions(members, trials, aggregateSkills) {
        if (!trials.length) return [];
        const medianBySkill = new Map((Array.isArray(aggregateSkills) ? aggregateSkills : []).map((skill) => [skill.skillHrid, skill.median]));
        return members.map((member) => {
            const options = trials.map((trial) => {
                const level = getProfileSkillLevel(member, trial.skillHrid);
                const guildMedian = medianBySkill.get(trial.skillHrid);
                return {
                    trialHrid: trial.trialHrid,
                    trialName: trial.name,
                    skillHrid: trial.skillHrid,
                    level,
                    guildMedian,
                    medianDifference: Number.isFinite(level) && Number.isFinite(guildMedian) ? level - guildMedian : null,
                };
            }).filter((option) => Number.isFinite(option.level) && Number.isFinite(option.guildMedian) && trialAllowsLevel(trials.find((trial) => trial.trialHrid === option.trialHrid), option.level))
                .sort((left, right) => right.medianDifference - left.medianDifference || right.level - left.level || left.trialName.localeCompare(right.trialName));
            if (!options.length) return null;
            return {
                memberId: member.id,
                memberName: member.name,
                currentTrialHrid: member.currentSkillingTrialHrid,
                first: options[0],
                second: options[1] || null,
            };
        }).filter(Boolean).sort((left, right) => left.memberName.localeCompare(right.memberName));
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
                    median: skill.median,
                    minLevel: skill.minLevel,
                    maxLevel: skill.maxLevel,
                    maxMembers: skill.maxMembers,
                    above100: skill.thresholdCounts[100].count,
                    above125: skill.thresholdCounts[125].count,
                    above150: skill.thresholdCounts[150].count,
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
                combatAuraCoverage: Object.fromEntries(trialAnalysis.combat.map((trial) => [
                    trial.trialHrid,
                    Object.fromEntries(trial.auraCoverage.map((aura) => [aura.hrid, aura.count])),
                ])),
            };
        }
        return snapshot;
    }

    function getPreviousSnapshot(snapshots, currentCapturedAt = Date.now()) {
        return [...(Array.isArray(snapshots) ? snapshots : [])]
            .filter((snapshot) => snapshot && snapshot.capturedAt < currentCapturedAt)
            .sort((left, right) => right.capturedAt - left.capturedAt)[0] || null;
    }

    function toCsv(aggregate, skillDetails = {}, trialDetails = {}, auraAssignments = {}, memberTracking = [], guildWeekStartAt = null) {
        const skillHrids = aggregate.skills.map((skill) => skill.skillHrid);
        const trackingById = new Map((Array.isArray(memberTracking) ? memberTracking : []).map((entry) => [String(entry.memberId), entry]));
        const header = ["Member", "Role", "Guild XP", "Weekly Guild XP", "Desired Aura", "Offline Days", "Offline 3+ Days", "Previous Week Trial", "Skilling Trial", "Combat Trial", "Combat Role", "Captured At", ...skillHrids.map((hrid) => getSkillName(hrid, skillDetails))];
        const rows = aggregate.members.map((member) => {
            const profile = member.profile;
            const tracking = trackingById.get(String(member.id));
            const skillMap = new Map((profile ? profile.skills : []).map((skill) => [skill.skillHrid, skill.level]));
            const currentSignup = isCurrentSignup(member, guildWeekStartAt);
            const previousWeekLabel = tracking && tracking.previousWeekStatus === "participated" ? "Signed"
                : tracking && tracking.previousWeekStatus === "missed" ? "No signup" : "Unknown";
            return [
                member.name,
                prettifyHrid(member.role),
                member.experience,
                member.weeklyExperience,
                (getAuraDefinition(getAuraAssignment(auraAssignments, member.id)) || {}).name || "",
                tracking && tracking.offlineDurationMs !== null ? (tracking.offlineDurationMs / DAY_MS).toFixed(1) : "",
                tracking && tracking.offlineThreeDays ? "Yes" : "No",
                previousWeekLabel,
                currentSignup && member.signedUpSkillingTrialHrid ? getTrialName(member.signedUpSkillingTrialHrid, trialDetails, skillDetails) : "",
                currentSignup && member.signedUpCombatTrialHrid ? getTrialName(member.signedUpCombatTrialHrid, trialDetails, skillDetails) : "",
                currentSignup && member.signedUpCombatRoleHrid ? prettifyHrid(member.signedUpCombatRoleHrid) : "",
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
        AURA_DEFINITIONS,
        DAY_MS,
        TOTAL_LEVEL_HRID,
        aggregateGuild,
        analyzeGuildEconomy,
        analyzeTrials,
        asObject,
        buildMemberTracking,
        getPreviousSnapshot,
        getPreviousWeekTrialStatus,
        getProfileIdentity,
        getAuraAssignment,
        getAuraDefinition,
        getItemName,
        getMarketQuote,
        getOfflineDurationMs,
        isCurrentSignup,
        getSkillName,
        getTrialName,
        makeSnapshot,
        median,
        normalizeName,
        normalizeProfile,
        normalizeRoster,
        normalizeSkills,
        parseJsonObject,
        prettifyHrid,
        recordWeeklyTrialParticipation,
        resolveGuildWeekStart,
        extractGuildBuffLevels,
        extractEconomyDefinitions,
        strongestSkill,
        toTimestamp,
        toCsv,
    };
});

function startGuildMonitor(Core) {
    "use strict";

    const SCRIPT_ID = "mwi-guild-monitor";
    const SCRIPT_VERSION = "0.8.5";
    const STORAGE_KEY = `${SCRIPT_ID}:v1`;
    const MARKET_STORAGE_KEY = `${SCRIPT_ID}:market:v1`;
    const MARKET_REFRESH_MS = 65 * 60_000;
    const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    const state = {
        guild: null,
        guildCharacterMap: {},
        guildSharableCharacterMap: {},
        guildTrialSignupLevelMap: {},
        guildWeeklyTrialSet: { skillHrids: [], combatHrids: [] },
        guildTrialDetails: {},
        skillDetails: {},
        itemDetails: {},
        guildBuffDetails: {},
        guildBuffLevels: {},
        marketData: {},
        marketItemValues: {},
        marketTimestamp: null,
        marketFetchedAt: null,
        marketLoading: false,
        marketError: "",
        ownCharacter: null,
        guildStore: null,
        isOpen: false,
        activeTab: "skills",
        query: "",
        sort: "name",
        lastMessageAt: null,
        renderQueued: false,
        trialRevision: 0,
        trialAnalysisCache: null,
        expandedShrines: new Set(),
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

    function getMarketDataUrl() {
        const hostname = String(pageWindow.location && pageWindow.location.hostname || "");
        if (hostname.startsWith("test.")) return "https://test.milkywayidle.com/game_data/marketplace.json";
        if (hostname.endsWith("milkywayidlecn.com")) return "https://milkywayidlecn.com/game_data/marketplace.json";
        return "https://www.milkywayidle.com/game_data/marketplace.json";
    }

    function applyMarketData(payload, fetchedAt = Date.now()) {
        if (!payload || !payload.marketData || typeof payload.marketData !== "object") return false;
        state.marketData = payload;
        state.marketFetchedAt = fetchedAt;
        state.marketTimestamp = Core.toTimestamp(payload.timestamp) || fetchedAt;
        state.marketError = "";
        return true;
    }

    function readMarketCache() {
        try {
            const cached = JSON.parse(localStorage.getItem(MARKET_STORAGE_KEY) || "null");
            if (cached && cached.version === 1 && applyMarketData(cached.payload, Number(cached.fetchedAt) || 0)) return cached;
        } catch (_error) {
            // A broken or old cache is replaced by the next official market response.
        }
        return null;
    }

    function writeMarketCache(payload, fetchedAt) {
        try {
            localStorage.setItem(MARKET_STORAGE_KEY, JSON.stringify({ version: 1, fetchedAt, payload }));
        } catch (error) {
            console.warn("[MWI Guild Monitor] Could not cache market data.", error);
        }
    }

    function applyEconomyDefinitions(payload, onlyMissing = false) {
        const definitions = Core.extractEconomyDefinitions(payload);
        if (Object.keys(definitions.itemDetails).length && (!onlyMissing || !Object.keys(state.itemDetails).length)) {
            state.itemDetails = definitions.itemDetails;
        }
        if (Object.keys(definitions.guildBuffDetails).length && (!onlyMissing || !Object.keys(state.guildBuffDetails).length)) {
            state.guildBuffDetails = definitions.guildBuffDetails;
        }
        return Object.keys(definitions.itemDetails).length > 0 || Object.keys(definitions.guildBuffDetails).length > 0;
    }

    function hydrateEconomyDefinitions() {
        if (Object.keys(state.itemDetails).length && Object.keys(state.guildBuffDetails).length) return;
        try {
            const cached = pageWindow.localStorageUtil && pageWindow.localStorageUtil.getInitClientData?.();
            if (cached) applyEconomyDefinitions(cached, true);
        } catch (_error) {
            // The game's cache helper is optional; the WebSocket and local cache paths remain available.
        }
        try {
            const cached = pageWindow.localStorage.getItem("initClientData");
            if (cached) applyEconomyDefinitions(cached, true);
        } catch (_error) {
            // Storage may be disabled or use a different format.
        }
    }

    async function refreshMarketData(force = false) {
        if (state.marketLoading) return;
        const cached = readMarketCache();
        if (!force && cached && Date.now() - cached.fetchedAt < MARKET_REFRESH_MS) {
            queueRender();
            return;
        }
        if (typeof pageWindow.fetch !== "function") {
            state.marketError = "Market fetch is unavailable in this browser.";
            queueRender();
            return;
        }

        state.marketLoading = true;
        state.marketError = "";
        queueRender();
        try {
            const response = await pageWindow.fetch(getMarketDataUrl(), {
                method: "GET",
                credentials: "omit",
                cache: "no-store",
            });
            if (!response.ok) throw new Error(`Market request failed (${response.status})`);
            const payload = await response.json();
            const fetchedAt = Date.now();
            if (!applyMarketData(payload, fetchedAt)) throw new Error("Market response was missing marketData");
            writeMarketCache(payload, fetchedAt);
        } catch (error) {
            state.marketError = error && error.message ? error.message : "Market prices could not be loaded.";
            console.warn("[MWI Guild Monitor] Could not load official market prices.", error);
        } finally {
            state.marketLoading = false;
            queueRender();
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
            auraAssignments: previous.auraAssignments || {},
            trialHistory: previous.trialHistory || {},
        };
        state.guildStore = store.guilds[key];
        return { store, key };
    }

    function captureTrialParticipation(observedAt = Date.now()) {
        if (!state.guild) return;
        const roster = Core.normalizeRoster(state.guildCharacterMap, state.guildSharableCharacterMap);
        if (!roster.length) return;
        const { store, key } = ensureGuildStore();
        const aggregate = Core.aggregateGuild(roster, store.guilds[key].profiles, state.skillDetails);
        const weekStart = Core.resolveGuildWeekStart(state.guild, observedAt);
        store.guilds[key].trialHistory = Core.recordWeeklyTrialParticipation(
            store.guilds[key].trialHistory,
            aggregate,
            weekStart,
            observedAt,
        );
        writeStore(store);
        state.guildStore = store.guilds[key];
    }

    function setAuraAssignment(memberId, auraHrid) {
        if (!state.guild) return;
        const { store, key } = ensureGuildStore();
        if (auraHrid) {
            store.guilds[key].auraAssignments[String(memberId)] = {
                auraHrid,
                updatedAt: Date.now(),
            };
        } else {
            delete store.guilds[key].auraAssignments[String(memberId)];
        }
        writeStore(store);
        state.guildStore = store.guilds[key];
        state.trialRevision += 1;
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
                applyEconomyDefinitions(message);
                void refreshMarketData();
                break;
            case "init_character_data":
                applyEconomyDefinitions(message);
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
                state.guildBuffLevels = Core.extractGuildBuffLevels(message, state.guildBuffLevels);
                break;
            case "guild_updated":
                state.guild = message.guild || null;
                state.guildWeeklyTrialSet = message.guildWeeklyTrialSet || state.guildWeeklyTrialSet;
                state.guildBuffLevels = Core.extractGuildBuffLevels(message, state.guildBuffLevels);
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
            case "market_item_values_updated":
                state.marketItemValues = message.marketItemValues || state.marketItemValues;
                break;
            case "guild_buffs_updated":
                state.guildBuffLevels = Core.extractGuildBuffLevels(message, state.guildBuffLevels);
                break;
            default:
                return;
        }

        if (["init_character_data", "guild_updated", "guild_characters_updated", "guild_trial_signup_updated"].includes(message.type)) {
            captureTrialParticipation();
        }

        if (message.type !== "market_item_values_updated" && message.type !== "guild_buffs_updated") {
            state.trialRevision += 1;
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
                width: min(860px, calc(100vw - 24px)); color: #e9eef7; background: #101827;
                border: 1px solid #40516f; border-radius: 8px; box-shadow: 0 18px 50px rgba(0,0,0,.55);
                font: 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                display: flex; flex-direction: column; overflow: hidden;
            }
            #${SCRIPT_ID}-panel[hidden] { display: none; }
            #${SCRIPT_ID}-panel, #${SCRIPT_ID}-panel * { box-sizing: border-box; }
            .mwigm-header { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid #31415c; }
            .mwigm-title { min-width: 0; flex: 1; }
            .mwigm-title strong { display: block; font-size: 16px; color: #fff; }
            .mwigm-title strong small { margin-left: 6px; color: #7f91aa; font-size: 10px; font-weight: 500; }
            .mwigm-title span { display: block; color: #aab7ca; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .mwigm-icon-button { width: 32px; height: 32px; padding: 0; border: 1px solid #526580; border-radius: 5px; background: #1a2740; color: #eef3fa; cursor: pointer; font-size: 18px; }
            .mwigm-icon-button:hover { background: #253756; }
            .mwigm-status { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-bottom: 1px solid #31415c; background: #141f33; }
            .mwigm-metric { padding: 10px 12px; border-right: 1px solid #31415c; min-width: 0; }
            .mwigm-metric:last-child { border-right: 0; }
            .mwigm-metric-label { color: #9cabc0; font-size: 11px; text-transform: uppercase; }
            .mwigm-metric-value { display: block; margin-top: 2px; color: #fff; font-size: 18px; font-weight: 650; }
            .mwigm-tabs { display: flex; flex: 0 0 auto; gap: 2px; padding: 8px 10px 0; overflow-x: auto; scrollbar-width: thin; border-bottom: 1px solid #31415c; background: #101827; }
            .mwigm-tab { flex: 0 0 auto; min-height: 34px; padding: 7px 11px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #aebbd0; cursor: pointer; }
            .mwigm-tab[aria-selected="true"] { color: #fff; border-bottom-color: #66c7a5; }
            .mwigm-toolbar { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #263651; }
            .mwigm-input, .mwigm-select { min-width: 0; height: 32px; border: 1px solid #526580; border-radius: 5px; background: #0c1422; color: #f3f6fa; padding: 5px 8px; }
            .mwigm-input { flex: 1; }
            .mwigm-command { height: 32px; border: 1px solid #526580; border-radius: 5px; background: #1a2942; color: #f1f5fb; padding: 5px 10px; cursor: pointer; white-space: nowrap; }
            .mwigm-command:hover { background: #263a5d; }
            .mwigm-command-primary { border-color: #4c9b82; background: #17634f; }
            .mwigm-command-primary:hover { background: #1d775f; }
            .mwigm-content { min-height: 0; flex: 1; overflow: auto; }
            .mwigm-table { width: 100%; min-width: 680px; border-collapse: collapse; table-layout: fixed; }
            .mwigm-table th { position: sticky; top: 0; z-index: 1; padding: 8px 10px; background: #1c293b; color: #c4d0df; font-weight: 600; text-align: right; border-bottom: 1px solid #52637c; white-space: normal; }
            .mwigm-table th:first-child { text-align: left; }
            .mwigm-table td { padding: 9px 10px; border-bottom: 1px solid #2b3a50; text-align: right; vertical-align: top; white-space: normal; overflow-wrap: anywhere; }
            .mwigm-table td:first-child { text-align: left; }
            .mwigm-table td.mwigm-no-results { padding: 20px 12px; color: #9eafc2; text-align: center; }
            .mwigm-table tbody tr:nth-child(even) { background: #141f2d; }
            .mwigm-table tbody tr:hover { background: #213044; }
            .mwigm-members-table { min-width: 900px; }
            .mwigm-skill-gap { color: #efbd70; }
            .mwigm-skill-list { border-top: 1px solid #31415c; }
            .mwigm-skill-row { display: grid; grid-template-columns: minmax(190px, 1.6fr) repeat(3, minmax(58px, .5fr)) minmax(170px, 1.35fr) minmax(62px, .5fr); border-bottom: 1px solid #2b3a53; }
            .mwigm-skill-primary, .mwigm-skill-stat { min-width: 0; padding: 9px 10px; }
            .mwigm-skill-primary { display: flex; flex-direction: column; justify-content: center; }
            .mwigm-skill-primary span { color: #92a2b9; font-size: 11px; white-space: normal; }
            .mwigm-skill-stat { border-left: 1px solid #2b3a53; text-align: right; }
            .mwigm-skill-stat > span { display: block; color: #92a2b9; font-size: 10px; }
            .mwigm-skill-stat > strong { display: block; margin-top: 2px; color: #f5f8fc; font-size: 14px; }
            .mwigm-skill-stat .mwigm-subtext { overflow-wrap: anywhere; }
            .mwigm-skill-row:hover { background: #17243a; }
            .mwigm-skill-name, .mwigm-member-name { color: #f6f8fc; font-weight: 600; }
            .mwigm-member-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; white-space: normal; }
            .mwigm-subtext { color: #92a2b9; font-size: 11px; }
            .mwigm-up { color: #68d5a9; }
            .mwigm-muted { color: #93a2b7; }
            .mwigm-missing { color: #f1bd67; }
            .mwigm-notice { margin: 12px; padding: 10px 12px; border-left: 3px solid #e2a84b; background: #292419; color: #f0e4cf; }
            .mwigm-notice-info { border-left-color: #61b99a; background: #172a29; color: #d5e9e1; }
            .mwigm-notice .mwigm-command { margin-top: 8px; }
            .mwigm-empty { padding: 44px 22px; text-align: center; color: #a8b5c8; }
            .mwigm-empty strong { display: block; color: #edf2f8; font-size: 15px; margin-bottom: 5px; }
            .mwigm-list { margin: 0; padding: 0; list-style: none; }
            .mwigm-list li { display: flex; gap: 10px; align-items: center; padding: 9px 12px; border-bottom: 1px solid #24334b; }
            .mwigm-list li > span:first-child { flex: 1; min-width: 0; }
            .mwigm-section-title { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 2px 12px; padding: 15px 12px 8px; border-bottom: 1px solid #40516a; color: #f3f6fb; font-size: 14px; font-weight: 650; }
            .mwigm-section-title span { color: #8fa0b7; font-size: 11px; font-weight: 400; }
            .mwigm-trial-name { font-weight: 650; color: #f4f7fb; }
            .mwigm-trial-type { color: #9aacc0; font-size: 10px; text-transform: uppercase; font-weight: 650; }
            .mwigm-roster-names { display: block; margin-top: 3px; line-height: 1.35; }
            .mwigm-chip { display: inline-block; padding: 1px 5px; border: 1px solid #536681; border-radius: 4px; color: #bdc9d9; font-size: 11px; white-space: nowrap; }
            .mwigm-table .mwigm-chip { max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
            .mwigm-chip-good { border-color: #3f9076; color: #77d2b2; }
            .mwigm-chip-warn { border-color: #9d7335; color: #efbd70; }
            .mwigm-chip-alert { border-color: #a34f4f; color: #f19a91; }
            .mwigm-member-skills { display: block; color: #aebbd0; font-size: 11px; }
            .mwigm-aura-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); border-bottom: 1px solid #31415c; }
            .mwigm-aura-summary { min-width: 0; padding: 9px 8px; border-right: 1px solid #31415c; text-align: center; }
            .mwigm-aura-summary:last-child { border-right: 0; }
            .mwigm-aura-summary strong { display: block; color: #f5f8fc; }
            .mwigm-aura-summary span { color: #8fa0b7; font-size: 10px; }
            .mwigm-aura-select { width: 100%; min-width: 110px; height: 30px; border: 1px solid #526580; border-radius: 5px; background: #0c1422; color: #f3f6fa; padding: 4px 7px; }
            .mwigm-aura-table, .mwigm-aura-coverage { min-width: 760px; }
            .mwigm-aura-missing { color: #efbd70; }
            .mwigm-aura-duplicate { color: #ef8f82; }
            .mwigm-economy-table { min-width: 800px; }
            .mwigm-trial-plan-table { min-width: 980px; }
            .mwigm-target-legend { display: flex; flex-wrap: wrap; gap: 8px 18px; padding: 8px 12px; color: #b9c8da; font-size: 11px; }
            #${SCRIPT_ID}-panel .mwigm-target-member { font-weight: 650; }
            #${SCRIPT_ID}-panel .mwigm-target-member::before { content: ""; display: inline-block; width: 7px; height: 7px; margin-right: 5px; border-radius: 50%; background: currentColor; vertical-align: middle; }
            #${SCRIPT_ID}-panel .mwigm-target-aligned { color: #77d2b2 !important; }
            #${SCRIPT_ID}-panel .mwigm-target-different { color: #efbd70 !important; }
            #${SCRIPT_ID}-panel .mwigm-target-unassessed { color: #aebbd0 !important; }
            .mwigm-shrine-table { min-width: 860px; }
            .mwigm-shrine-group { border-bottom: 1px solid #35445b; }
            .mwigm-shrine-group > summary { padding: 12px 14px; background: #172438; color: #f3f6fb; cursor: pointer; font-weight: 650; }
            .mwigm-shrine-group > summary:hover, .mwigm-shrine-group[open] > summary { background: #213348; }
            .mwigm-shrine-group > summary:focus-visible { outline: 2px solid #68d5a9; outline-offset: -2px; }
            .mwigm-shrine-summary-meta { margin-left: 8px; color: #aebdd0; font-size: 11px; font-weight: 400; }
            .mwigm-shrine-table-scroll { max-width: 100%; overflow-x: auto; }
            .mwigm-price-source { color: #8fa0b7; font-size: 10px; text-transform: uppercase; }
            .mwigm-price-best { color: #77d2b2; }
            .mwigm-purchased { color: #77d2b2; }
            .mwigm-footer { padding: 8px 12px; color: #8190a6; font-size: 11px; border-top: 1px solid #31415c; }
            @media (max-width: 620px) {
                #${SCRIPT_ID}-panel { top: 0; right: 0; bottom: 0; width: 100vw; border-radius: 0; }
                .mwigm-status { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                .mwigm-metric:nth-child(2) { border-right: 0; }
                .mwigm-metric:nth-child(-n+2) { border-bottom: 1px solid #31415c; }
                .mwigm-toolbar { flex-wrap: wrap; }
                .mwigm-input { flex-basis: 100%; }
                .mwigm-skill-row { grid-template-columns: repeat(3, minmax(0, 1fr)); }
                .mwigm-skill-primary { grid-column: 1 / -1; }
                .mwigm-skill-gap { grid-column: span 2; text-align: left; }
                .mwigm-aura-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                .mwigm-aura-summary { border-bottom: 1px solid #31415c; }
                .mwigm-aura-table { min-width: 0; }
                .mwigm-aura-table th:nth-child(3), .mwigm-aura-table td:nth-child(3) { display: none; }
                .mwigm-aura-table th:nth-child(4), .mwigm-aura-table td:nth-child(4) { display: none; }
                .mwigm-aura-table th:nth-child(5), .mwigm-aura-table td:nth-child(5),
                .mwigm-aura-coverage th:nth-child(5), .mwigm-aura-coverage td:nth-child(5) { display: table-cell; }
                .mwigm-aura-table th:first-child { width: 29% !important; }
                .mwigm-aura-table th:nth-child(2) { width: 46% !important; }
            }
        `;
        document.head.appendChild(style);
    }

    function createShell() {
        if (document.getElementById(`${SCRIPT_ID}-panel`)) return;
        injectStyles();
        hydrateEconomyDefinitions();
        readMarketCache();

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
                <div class="mwigm-title"><strong>Guild Monitor <small>v${SCRIPT_VERSION}</small></strong><span>Waiting for game data</span></div>
                <button class="mwigm-icon-button" type="button" data-action="close" title="Close Guild Monitor" aria-label="Close Guild Monitor">&times;</button>
            </header>
            <div class="mwigm-status"></div>
            <nav class="mwigm-tabs" aria-label="Guild Monitor views">
                <button class="mwigm-tab" type="button" data-tab="skills">Skills</button>
                <button class="mwigm-tab" type="button" data-tab="members">Members</button>
                <button class="mwigm-tab" type="button" data-tab="auras">Auras</button>
                <button class="mwigm-tab" type="button" data-tab="trials">Trials</button>
                <button class="mwigm-tab" type="button" data-tab="shrines">Shrines</button>
                <button class="mwigm-tab" type="button" data-tab="missing">Missing profiles</button>
            </nav>
            <div class="mwigm-toolbar"></div>
            <div class="mwigm-content"></div>
            <footer class="mwigm-footer">Read-only. Guild data stays in this browser; prices come from the official market feed.</footer>
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
        const weekStart = Core.resolveGuildWeekStart(state.guild);
        const cached = state.trialAnalysisCache;
        if (cached && cached.revision === state.trialRevision && cached.weekStart === weekStart) return cached.result;
        const result = Core.analyzeTrials({
            aggregate,
            weeklyTrialSet: state.guildWeeklyTrialSet,
            trialDetails: state.guildTrialDetails,
            signupLevels: state.guildTrialSignupLevelMap,
            trialMinLevels: state.guild && state.guild.trialMinLevelsData,
            guildWeekStartAt: state.guild && state.guild.currentWeekStartAt,
            skillDetails: state.skillDetails,
            auraAssignments: state.guildStore ? state.guildStore.auraAssignments : {},
        });
        state.trialAnalysisCache = { revision: state.trialRevision, weekStart, result };
        return result;
    }

    function currentMemberTracking(aggregate = currentAggregate()) {
        return Core.buildMemberTracking(
            aggregate,
            state.guildStore ? state.guildStore.trialHistory : {},
            Core.resolveGuildWeekStart(state.guild),
        );
    }

    function currentGuildEconomy() {
        return Core.analyzeGuildEconomy({
            itemDetails: state.itemDetails,
            guildBuffDetails: state.guildBuffDetails,
            guildBuffLevels: state.guildBuffLevels,
            marketData: state.marketData,
            marketItemValues: state.marketItemValues,
        });
    }

    function render() {
        const panel = document.getElementById(`${SCRIPT_ID}-panel`);
        const button = document.getElementById(`${SCRIPT_ID}-button`);
        if (!panel || !button) return;

        const focusedQuery = document.activeElement && document.activeElement.dataset.control === "query"
            ? { start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd }
            : null;
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
        if (focusedQuery) {
            const query = toolbar.querySelector('[data-control="query"]');
            query.focus({ preventScroll: true });
            query.setSelectionRange(focusedQuery.start, focusedQuery.end);
        }
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
        const searchPlaceholder = state.activeTab === "skills" ? "Find a skill" : state.activeTab === "trials" ? "Find a trial or member" : state.activeTab === "shrines" ? "Find a shrine, credit, or item" : "Find a member";
        if (state.activeTab === "shrines") {
            return `
                <input class="mwigm-input" data-control="query" type="search" placeholder="${searchPlaceholder}" value="${escapeHtml(state.query)}" aria-label="${searchPlaceholder}">
                <button class="mwigm-command mwigm-command-primary" type="button" data-action="refresh-market" title="Refresh official prices and reread game economy definitions" ${state.marketLoading ? "disabled" : ""}>${state.marketLoading ? "Refreshing" : "Refresh prices"}</button>
            `;
        }
        const sortOptions = state.activeTab === "skills"
            ? `<option value="name">Skill name</option><option value="average">Highest average</option><option value="median">Highest median</option><option value="max">Highest max</option><option value="min">Lowest min</option>`
            : state.activeTab === "trials"
            ? `<option value="name">Trial or member</option><option value="gap">Needs review first</option>`
            : state.activeTab === "auras"
            ? `<option value="name">Member name</option><option value="aura">Aura type</option><option value="unsigned">Unsigned first</option>`
            : state.activeTab === "members"
            ? `<option value="name">Member name</option><option value="total">Highest total</option><option value="offline">Longest offline</option><option value="missed">Missed last week</option><option value="freshness">Oldest profile</option>`
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
        if (state.activeTab === "auras") return renderAuras(aggregate);
        if (state.activeTab === "shrines") return renderShrines();
        if (state.activeTab === "missing") return renderMissing(aggregate);
        return renderSkills(aggregate);
    }

    function renderSkills(aggregate) {
        if (!aggregate.coveredCount) {
            return `${coverageNotice(aggregate)}${emptyState("No profiles captured", "Open a guild member's Profile in the game. Each viewed profile is added automatically.")}`;
        }

        const previous = Core.getPreviousSnapshot(state.guildStore ? state.guildStore.snapshots : []);
        const analysis = currentTrialAnalysis(aggregate);
        const gapBySkill = new Map(analysis.highLevelSkillGaps.map((gap) => [gap.skillHrid, gap]));
        const query = state.query.toLocaleLowerCase();
        let skills = aggregate.skills.filter((skill) => {
            const gap = gapBySkill.get(skill.skillHrid);
            const memberNames = [
                ...skill.maxMembers,
                ...(gap ? gap.members.map((member) => member.memberName) : []),
            ].join(" ").toLocaleLowerCase();
            return skill.name.toLocaleLowerCase().includes(query) || memberNames.includes(query);
        });
        skills = sortSkills(skills);
        const rows = skills.map((skill) => {
            const oldValue = previous && previous.skills && previous.skills[skill.skillHrid];
            const delta = oldValue ? skill.average - oldValue.average : null;
            const maxNames = skill.maxMembers.join(", ");
            const thresholdStat = (threshold) => {
                const summary = skill.thresholdCounts[threshold];
                const names = summary.members.map((member) => `${member.memberName} (${member.level})`).join(", ") || "No members";
                return `<div class="mwigm-skill-stat" title="${escapeHtml(names)}"><span>Over ${threshold}</span><strong>${summary.count}</strong></div>`;
            };
            const gap = gapBySkill.get(skill.skillHrid);
            const gapNames = gap ? gap.members.map((member) => `${member.memberName} (${member.level})`) : [];
            const gapStat = !gap
                ? `<div class="mwigm-skill-stat mwigm-skill-gap" title="This skill is not offered in the current weekly trial set"><span>Over 125 not in trial</span><strong>--</strong></div>`
                : gapNames.length
                ? `<div class="mwigm-skill-stat mwigm-skill-gap" title="${escapeHtml(gapNames.join(", "))}"><span>Over 125 not in trial</span><strong>${gapNames.length}</strong><span class="mwigm-subtext">${escapeHtml(gapNames.join(", "))}</span></div>`
                : `<div class="mwigm-skill-stat mwigm-skill-gap" title="Every captured member above level 125 joined this skill's trial"><span>Over 125 not in trial</span><strong class="mwigm-up">0</strong></div>`;
            return `
                <div class="mwigm-skill-row" title="Minimum: ${escapeHtml(skill.minMembers.join(", "))}">
                    <div class="mwigm-skill-primary">
                        <span class="mwigm-skill-name">${escapeHtml(skill.name)}</span>
                        <span>${skill.sampleSize} member${skill.sampleSize === 1 ? "" : "s"} · Average ${skill.average.toFixed(1)} · Median ${Number.isFinite(skill.median) ? skill.median.toFixed(1) : "--"} · Minimum ${skill.minLevel}</span>
                        <span title="${escapeHtml(maxNames)}">Highest ${skill.maxLevel} · ${escapeHtml(maxNames)}</span>
                    </div>
                    ${thresholdStat(100)}
                    ${thresholdStat(125)}
                    ${thresholdStat(150)}
                    ${gapStat}
                    <div class="mwigm-skill-stat"><span>Change</span><strong class="${delta !== null && delta > 0 ? "mwigm-up" : "mwigm-muted"}">${formatDelta(delta)}</strong></div>
                </div>
            `;
        }).join("");

        return `${coverageNotice(aggregate)}${rows ? `<div class="mwigm-skill-list">${rows}</div>` : emptyState("No matching skills", "Try another skill or member name.")}`;
    }

    function renderMembers(aggregate) {
        const tracking = currentMemberTracking(aggregate);
        const trackingById = new Map(tracking.map((entry) => [String(entry.memberId), entry]));
        const medianSuggestionById = new Map(currentTrialAnalysis(aggregate).medianSuggestions.map((entry) => [String(entry.memberId), entry]));
        const weekStart = Core.resolveGuildWeekStart(state.guild);
        let members = aggregate.members.filter((member) => member.name.toLocaleLowerCase().includes(state.query.toLocaleLowerCase()));
        members = sortMembers(members, trackingById);
        const offlineCount = tracking.filter((entry) => entry.offlineThreeDays).length;
        const missedCount = tracking.filter((entry) => entry.previousWeekStatus === "missed").length;
        const knownPreviousCount = tracking.filter((entry) => entry.previousWeekStatus !== "unknown").length;
        const hiddenCount = aggregate.members.filter((member) => member.hideOnlineStatus).length;
        const overview = `
            <div class="mwigm-status">
                ${metric("Offline 3d+", offlineCount)}
                ${metric("No signup last week", missedCount)}
                ${metric("Prior week known", `${knownPreviousCount}/${aggregate.memberCount}`)}
                ${metric("Hidden status", hiddenCount)}
            </div>
        `;
        const rows = members.map((member) => {
            const profile = member.profile;
            const memberTracking = trackingById.get(String(member.id));
            const trialSuggestion = medianSuggestionById.get(String(member.id));
            const total = profile ? profile.skills.find((skill) => skill.skillHrid === Core.TOTAL_LEVEL_HRID) : null;
            const strongest = Core.strongestSkill(member, state.skillDetails);
            const auraHrid = Core.getAuraAssignment(state.guildStore ? state.guildStore.auraAssignments : {}, member.id);
            const aura = Core.getAuraDefinition(auraHrid);
            const currentSignup = Core.isCurrentSignup(member, weekStart);
            const skillingTrial = currentSignup && member.signedUpSkillingTrialHrid ? Core.getTrialName(member.signedUpSkillingTrialHrid, state.guildTrialDetails, state.skillDetails) : "None";
            const combatTrial = currentSignup && member.signedUpCombatTrialHrid ? Core.getTrialName(member.signedUpCombatTrialHrid, state.guildTrialDetails, state.skillDetails) : "None";
            const activity = member.isOnline
                ? "Online"
                : member.hideOnlineStatus
                ? "Status hidden"
                : memberTracking && memberTracking.offlineDurationMs !== null
                ? `Offline ${formatElapsedDuration(memberTracking.offlineDurationMs)}`
                : "Offline time unknown";
            const previousWeekStatus = memberTracking ? memberTracking.previousWeekStatus : "unknown";
            const previousWeekLabel = previousWeekStatus === "missed" ? "No signup" : previousWeekStatus === "participated" ? "Signed" : "Unknown";
            const previousWeekClass = previousWeekStatus === "missed" ? "mwigm-chip-alert" : previousWeekStatus === "participated" ? "mwigm-chip-good" : "";
            const trialChoices = trialSuggestion
                ? `${renderMemberTrialChoice(trialSuggestion.first, "1st", "mwigm-chip-good")}${trialSuggestion.second ? renderMemberTrialChoice(trialSuggestion.second, "2nd", "") : ""}`
                : "";
            return `
                <tr>
                    <td><span class="mwigm-member-heading"><span class="mwigm-member-name">${escapeHtml(member.name)}</span>${trialChoices}${memberTracking && memberTracking.offlineThreeDays ? `<span class="mwigm-chip mwigm-chip-alert">Offline 3d+</span>` : ""}</span><span class="mwigm-subtext">${escapeHtml(Core.prettifyHrid(member.role))} · ${escapeHtml(activity)}</span>${strongest ? `<span class="mwigm-member-skills">Best: ${escapeHtml(strongest.name)} ${strongest.level}</span>` : ""}${aura ? `<span class="mwigm-member-skills">Aura: ${escapeHtml(aura.name)}</span>` : ""}</td>
                    <td>${total ? total.level : "--"}</td>
                    <td>${formatNumber(member.experience)}</td>
                    <td>${formatNumber(member.weeklyExperience)}</td>
                    <td title="Skilling: ${escapeHtml(skillingTrial)} · Combat: ${escapeHtml(combatTrial)}${currentSignup && member.signedUpCombatRoleHrid ? ` · ${escapeHtml(Core.prettifyHrid(member.signedUpCombatRoleHrid))}` : ""}"><span class="mwigm-trial-type">Skill</span> ${escapeHtml(skillingTrial)}<br><span class="mwigm-trial-type">Combat</span> ${escapeHtml(combatTrial)}</td>
                    <td><span class="mwigm-chip ${previousWeekClass}">${previousWeekLabel}</span></td>
                    <td class="${profile ? "mwigm-muted" : "mwigm-missing"}">${profile ? formatRelativeTime(profile.capturedAt) : "Not viewed"}</td>
                </tr>
            `;
        }).join("");
        return `${overview}<table class="mwigm-table mwigm-members-table"><thead><tr><th style="width:25%">Member</th><th>Total</th><th>Guild XP</th><th>Weekly XP</th><th>Current trials</th><th>Previous week</th><th>Profile</th></tr></thead><tbody>${rows || emptyTableRow(7)}</tbody></table>`;
    }

    function renderMemberTrialChoice(choice, rank, className) {
        const difference = choice.medianDifference >= 0 ? `+${formatCompactDecimal(choice.medianDifference)}` : formatCompactDecimal(choice.medianDifference);
        const title = `${choice.trialName}: level ${formatCompactDecimal(choice.level)}, ${difference} vs guild median ${formatCompactDecimal(choice.guildMedian)}. Individual fit; the optimized roster may differ.`;
        return `<span class="mwigm-chip ${className}" title="${escapeHtml(title)}">${rank} ${escapeHtml(choice.trialName)}</span>`;
    }

    function renderTrials(aggregate) {
        const analysis = currentTrialAnalysis(aggregate);
        if (!analysis.hasTrialData) {
            return emptyState("Waiting for weekly trials", "Reload the game or open Guild > Trials so the current trial set is available.");
        }

        const signedCount = analysis.optimalDistribution.reduce((sum, trial) => sum + trial.actualSignups.length, 0);
        const unassessedCount = analysis.optimalDistribution.reduce((sum, trial) => sum + trial.unassessedCount, 0);
        const hasAssessedTargets = analysis.recommendations.length > 0;
        const targetNotice = !signedCount
            ? `<div class="mwigm-notice">No current skilling signups to distribute. Combat-only and unsigned members are not added to this target.</div>`
            : !aggregate.coveredCount
            ? `<div class="mwigm-notice"><strong>No trial moves calculated: 0/${aggregate.memberCount} member profiles captured.</strong> The target roster mirrors actual skilling signups in gray until their profiles are viewed. Open Guild &gt; Members, then open members' profiles while Guild Monitor is enabled. Profiles viewed before the script was enabled need to be opened again.<br><button class="mwigm-command" type="button" data-tab="missing">View missing profiles</button></div>`
            : !hasAssessedTargets
            ? `<div class="mwigm-notice"><strong>No signed members have eligible captured levels.</strong> All ${signedCount} skilling signups remain in their current trial. Check Missing profiles and the trial requirements.</div>`
            : `<div class="mwigm-notice mwigm-notice-info">The target includes all ${signedCount} current skilling signups. ${analysis.recommendations.length} have eligible captured levels and can be reassigned; ${unassessedCount} remain in their signed trial without an assessed recommendation. The optimizer aims to balance total roster sizes and maximize known median-relative levels. Averages use captured levels only. Signup slot caps, gear, buffs, and availability are not modeled.</div>`;

        const query = state.query.toLocaleLowerCase();
        const overview = `
            <div class="mwigm-status">
                ${metric("Skilling signed", `${analysis.skillingSignedCount}/${aggregate.memberCount}`)}
                ${metric("Combat signed", `${analysis.combatSignedCount}/${aggregate.memberCount}`)}
                ${metric("Any trial", `${analysis.anyTrialSignedCount}/${aggregate.memberCount}`)}
                ${metric("No trial signup", analysis.unsignedTrials.length)}
            </div>
        `;
        const unsignedNotice = analysis.unsignedTrials.length
            ? `<div class="mwigm-notice"><strong>No skilling or combat signup:</strong> ${escapeHtml(analysis.unsignedTrials.map((member) => member.name).join(", "))}</div>`
            : "";
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
                const rank = (entry) => entry.isAligned ? 2 : entry.currentTrialHrid ? 0 : 1;
                return rank(left) - rank(right) || left.memberName.localeCompare(right.memberName);
            });
        }
        const recommendationRows = recommendations.map((entry) => {
            const status = entry.signupStatus === "aligned" ? "Aligned" : "Different skilling";
            const statusClass = entry.signupStatus === "aligned" ? "mwigm-chip-good" : "mwigm-chip-warn";
            const nameClass = entry.signupStatus === "aligned" ? "mwigm-target-aligned" : "mwigm-target-different";
            return `
                <tr>
                    <td><span class="mwigm-target-member ${nameClass}">${escapeHtml(entry.memberName)}</span><br><span class="mwigm-subtext">${escapeHtml(entry.reason)}</span></td>
                    <td>${escapeHtml(entry.currentTrialName)}${Number.isFinite(entry.currentLevel) ? ` <span class="mwigm-subtext">Lv ${entry.currentLevel}</span>` : ""}</td>
                    <td>${escapeHtml(entry.recommendedTrialName)} <span class="mwigm-subtext">Lv ${entry.recommendedLevel} · ${formatSignedDifference(entry.medianDifference)} vs median</span></td>
                    <td><span class="mwigm-chip ${statusClass}">${status}</span></td>
                </tr>
            `;
        }).join("");
        const distributionRows = analysis.optimalDistribution.filter((trial) =>
            trial.trialName.toLocaleLowerCase().includes(query) ||
            trial.assignments.some((entry) => entry.memberName.toLocaleLowerCase().includes(query)) ||
            trial.actualSignups.some((entry) => entry.memberName.toLocaleLowerCase().includes(query)),
        ).map((trial) => {
            const actualNames = trial.actualSignups.map((entry) => entry.memberName).join(", ") || "No signups";
            const targetNames = trial.assignments.map((entry) => {
                const statusClass = entry.signupStatus === "aligned" ? "mwigm-target-aligned" : entry.signupStatus === "different" ? "mwigm-target-different" : "mwigm-target-unassessed";
                const statusTitle = entry.signupStatus === "aligned" ? "Signed for this skilling trial" : entry.signupStatus === "different" ? `Currently signed for ${entry.currentTrialName}` : entry.hasProfile ? "Kept here: no eligible captured trial level" : "Kept here: profile not captured";
                const level = Number.isFinite(entry.recommendedLevel) ? ` <span class="mwigm-subtext">(Lv ${entry.recommendedLevel})</span>` : "";
                return `<span class="mwigm-target-member ${statusClass}" title="${escapeHtml(statusTitle)}">${escapeHtml(entry.memberName)}</span>${level}`;
            }).join(", ") || "No skilling signups targeted";
            const targetIds = new Set(trial.assignments.map((entry) => String(entry.memberId)));
            const incoming = trial.signedElsewhere.length;
            const outgoing = trial.actualSignups.filter((entry) => !targetIds.has(String(entry.memberId))).length;
            const changeText = incoming || outgoing ? `${incoming} in · ${outgoing} out` : trial.unassessedCount ? `${trial.unassessedCount} unassessed` : "Aligned";
            return `
                <tr>
                    <td><span class="mwigm-trial-name">${escapeHtml(trial.trialName)}</span></td>
                    <td><strong>${trial.actualSignups.length} signed</strong><span class="mwigm-subtext mwigm-roster-names">${escapeHtml(actualNames)}</span></td>
                    <td>${Number.isFinite(trial.actualAverageLevel) ? trial.actualAverageLevel.toFixed(1) : "--"}<span class="mwigm-subtext mwigm-roster-names">${trial.actualProfileCount}/${trial.actualSignups.length} profiles</span></td>
                    <td><strong>${trial.assignments.length} targeted</strong><span class="mwigm-roster-names">${targetNames}</span></td>
                    <td>${Number.isFinite(trial.targetAverageLevel) ? trial.targetAverageLevel.toFixed(1) : "--"}<span class="mwigm-subtext mwigm-roster-names">${trial.targetProfileCount}/${trial.assignments.length} levels</span></td>
                    <td class="${incoming || outgoing ? "mwigm-missing" : trial.unassessedCount ? "mwigm-muted" : "mwigm-up"}">${changeText}</td>
                </tr>
            `;
        }).join("");
        const mismatches = recommendations.filter((entry) => entry.currentTrialHrid && !entry.isAligned);
        const mismatchNotice = mismatches.length
            ? `<div class="mwigm-notice"><strong>${mismatches.length} different signup${mismatches.length === 1 ? "" : "s"} in this view.</strong> These members are signed for a skilling trial other than their balanced target. See Member assignments below.</div>`
            : "";

        return `
            ${overview}
            ${unsignedNotice}
            <div class="mwigm-section-title">Actual skilling signups <span>Signup-time levels when available</span></div>
            <table class="mwigm-table"><thead><tr><th style="width:34%">Trial</th><th>Signed</th><th>Average</th><th>Range</th><th>Minimum</th></tr></thead><tbody>${skillingRows || emptyTableRow(5)}</tbody></table>
            <div class="mwigm-section-title">Combat trials <span>Role mix and combat level</span></div>
            <table class="mwigm-table"><thead><tr><th style="width:34%">Trial</th><th>Signed</th><th>Average</th><th colspan="2">Roles</th></tr></thead><tbody>${combatRows || emptyTableRow(5)}</tbody></table>
            ${renderCombatAuraCoverage(analysis)}
            <div class="mwigm-section-title">Optimal skilling distribution <span>Balanced target roster using median-relative skill fit</span></div>
            ${targetNotice}
            ${signedCount ? `<div class="mwigm-target-legend" aria-label="Optimized roster signup status"><span class="mwigm-target-member mwigm-target-aligned">Green: signed here, assessed</span><span class="mwigm-target-member mwigm-target-different">Yellow: signed for a different skill</span><span class="mwigm-target-member mwigm-target-unassessed">Gray: kept here, unassessed</span></div>` : ""}
            ${hasAssessedTargets && !analysis.allocationBalanced ? `<div class="mwigm-notice">Target rosters are uneven because held signups or level minimums prevent a balanced assignment. This is a best-fit fallback, not a global optimum.</div>` : ""}
            ${mismatchNotice}
            <table class="mwigm-table mwigm-trial-plan-table"><thead><tr><th style="width:15%">Trial</th><th style="width:25%">Actually signed</th><th>Actual avg</th><th style="width:25%">Optimized target</th><th>Target avg</th><th>Changes</th></tr></thead><tbody>${distributionRows || emptyTableRow(6)}</tbody></table>
            <div class="mwigm-section-title">Member assignments <span>Current signup compared with the optimal distribution</span></div>
            <table class="mwigm-table"><thead><tr><th style="width:34%">Member</th><th>Current</th><th>Optimal</th><th>Status</th></tr></thead><tbody>${recommendationRows || `<tr><td class="mwigm-no-results" colspan="4">${hasAssessedTargets ? "No matching members" : "No signed members assessed yet"}</td></tr>`}</tbody></table>
        `;
    }

    function renderTrialRow(trial, isCombat) {
        const memberNames = trial.signups.map((entry) => `${entry.memberName}${Number.isFinite(entry.level) ? ` (${entry.level})` : ""}`).join(", ") || "No signups";
        const range = Number.isFinite(trial.minSignupLevel) ? `${trial.minSignupLevel}-${trial.maxSignupLevel}` : "--";
        const roles = Object.entries(trial.roles).map(([role, count]) => `${Core.prettifyHrid(role)} ${count}`).join(", ") || "--";
        return `
            <tr>
                <td><span class="mwigm-trial-name">${escapeHtml(trial.name)}</span><span class="mwigm-subtext mwigm-roster-names">${escapeHtml(memberNames)}</span></td>
                <td>${trial.signupCount}</td>
                <td>${Number.isFinite(trial.averageLevel) ? trial.averageLevel.toFixed(1) : "--"}</td>
                ${isCombat ? `<td colspan="2">${escapeHtml(roles)}</td>` : `<td>${range}</td><td>${trial.minLevel || "--"}</td>`}
            </tr>
        `;
    }

    function renderCombatAuraCoverage(analysis) {
        const rows = analysis.combat.map((trial) => {
            const cells = trial.auraCoverage.map((aura) => {
                const names = aura.members.map((member) => member.memberName).join(", ");
                const className = aura.status === "covered" ? "mwigm-up" : aura.status === "duplicate" ? "mwigm-aura-duplicate" : "mwigm-aura-missing";
                const label = aura.status === "missing" ? "Missing" : names;
                return `<td class="${className}" title="${escapeHtml(aura.name)}: ${escapeHtml(label)}">${escapeHtml(label)}</td>`;
            }).join("");
            return `<tr><td><span class="mwigm-trial-name">${escapeHtml(trial.name)}</span><br><span class="mwigm-subtext">${trial.auraCoveredCount}/5 exact coverage</span></td>${cells}</tr>`;
        }).join("");
        const headers = Core.AURA_DEFINITIONS.map((aura) => `<th>${escapeHtml(aura.name.replace(" Aura", ""))}</th>`).join("");
        return `
            <div class="mwigm-section-title">Combat aura coverage <span>Exactly one of each desired aura</span></div>
            <table class="mwigm-table mwigm-aura-coverage"><thead><tr><th style="width:22%">Trial</th>${headers}</tr></thead><tbody>${rows}</tbody></table>
        `;
    }

    function renderAuras(aggregate) {
        const analysis = currentTrialAnalysis(aggregate);
        const assignments = state.guildStore ? state.guildStore.auraAssignments : {};
        const query = state.query.toLocaleLowerCase();
        const counts = Core.AURA_DEFINITIONS.map((aura) => ({
            ...aura,
            count: aggregate.members.filter((member) => Core.getAuraAssignment(assignments, member.id) === aura.hrid).length,
        }));
        let members = aggregate.members.filter((member) => {
            const aura = Core.getAuraDefinition(Core.getAuraAssignment(assignments, member.id));
            return member.name.toLocaleLowerCase().includes(query) || (aura && aura.name.toLocaleLowerCase().includes(query));
        });
        if (state.sort === "aura") {
            members = [...members].sort((left, right) => {
                const leftAura = Core.getAuraDefinition(Core.getAuraAssignment(assignments, left.id));
                const rightAura = Core.getAuraDefinition(Core.getAuraAssignment(assignments, right.id));
                return (leftAura ? leftAura.name : "Zzz").localeCompare(rightAura ? rightAura.name : "Zzz") || left.name.localeCompare(right.name);
            });
        } else if (state.sort === "unsigned") {
            const weekStart = Core.resolveGuildWeekStart(state.guild);
            members = [...members].sort((left, right) => Number(Core.isCurrentSignup(left, weekStart) && Boolean(left.signedUpCombatTrialHrid)) - Number(Core.isCurrentSignup(right, weekStart) && Boolean(right.signedUpCombatTrialHrid)) || left.name.localeCompare(right.name));
        } else {
            members = [...members].sort((left, right) => left.name.localeCompare(right.name));
        }

        const summary = `<div class="mwigm-aura-grid">${counts.map((aura) => `<div class="mwigm-aura-summary"><strong>${aura.count}</strong><span>${escapeHtml(aura.name)}</span></div>`).join("")}</div>`;
        const options = (selected) => [
            `<option value="">No aura assigned</option>`,
            ...Core.AURA_DEFINITIONS.map((aura) => `<option value="${escapeHtml(aura.hrid)}"${aura.hrid === selected ? " selected" : ""}>${escapeHtml(aura.name)}</option>`),
        ].join("");
        const rows = members.map((member) => {
            const auraHrid = Core.getAuraAssignment(assignments, member.id);
            const aura = Core.getAuraDefinition(auraHrid);
            const scalingSkill = aura && member.profile ? member.profile.skills.find((skill) => skill.skillHrid === aura.scalingSkillHrid) : null;
            const trial = analysis.combat.find((entry) => entry.signups.some((signup) => signup.memberId === member.id));
            const tracking = analysis.auraTracking.find((entry) => entry.memberId === member.id);
            const statusClass = !tracking ? "" : tracking.status === "unsigned" || tracking.status === "duplicate" ? "mwigm-chip-warn" : "mwigm-chip-good";
            const statusText = !aura ? "Unassigned" : !trial ? "Not signed" : tracking && tracking.status === "duplicate" ? "Duplicate" : "Covered";
            return `
                <tr>
                    <td><span class="mwigm-member-name">${escapeHtml(member.name)}</span><br><span class="mwigm-subtext">${escapeHtml(Core.prettifyHrid(member.role))} · ${trial ? escapeHtml(trial.name) : "Not signed"}</span></td>
                    <td><select class="mwigm-aura-select" data-aura-member-id="${escapeHtml(member.id)}" aria-label="Desired aura for ${escapeHtml(member.name)}">${options(auraHrid)}</select></td>
                    <td>${aura ? `${escapeHtml(Core.getSkillName(aura.scalingSkillHrid, state.skillDetails))} ${scalingSkill ? scalingSkill.level : "--"}` : "--"}</td>
                    <td>${trial ? escapeHtml(trial.name) : "Not signed"}</td>
                    <td><span class="mwigm-chip ${statusClass}">${statusText}</span></td>
                </tr>
            `;
        }).join("");

        return `
            ${summary}
            <div class="mwigm-notice mwigm-notice-info">Choose the primary aura each member is expected to bring. Assignments are planning labels stored only in this browser; they do not inspect loadouts or change trial signups.</div>
            <table class="mwigm-table mwigm-aura-table"><thead><tr><th style="width:24%">Member</th><th style="width:25%">Desired aura</th><th>Scaling skill</th><th>Combat trial</th><th>Status</th></tr></thead><tbody>${rows || emptyTableRow(5)}</tbody></table>
        `;
    }

    function renderShrines() {
        const economy = currentGuildEconomy();
        const query = state.query.toLocaleLowerCase();
        const marketLabel = state.marketLoading ? "Refreshing" : state.marketTimestamp ? formatRelativeTime(state.marketTimestamp) : "Unavailable";
        const overview = `
            <div class="mwigm-status">
                ${metric("Market updated", marketLabel)}
                ${metric("Credit types", economy.credits.length)}
                ${metric("Guild token value", Number.isFinite(economy.guildTokenValue) ? formatCoins(economy.guildTokenValue) : "--")}
                ${metric("Shrine levels priced", `${economy.pricedLevelCount}/${economy.levelCount}`)}
            </div>
        `;
        const missingDefinitions = [
            !economy.credits.length ? "guild-credit conversion rules" : "",
            !economy.shrines.length ? "shrine buff costs" : "",
        ].filter(Boolean);
        const definitionNotice = missingDefinitions.length
            ? `<div class="mwigm-notice"><strong>Game economy definitions missing:</strong> ${escapeHtml(missingDefinitions.join(" and "))}. Reload the game after enabling the script, then open Guild Shop. Refresh prices also retries the game's cached definitions, but the market feed alone does not contain conversion or shrine costs.</div>`
            : "";
        const checkedNotice = state.marketFetchedAt
            ? `<div class="mwigm-notice mwigm-notice-info">Official market prices last checked ${escapeHtml(formatRelativeTime(state.marketFetchedAt))}.</div>`
            : "";
        const errorNotice = state.marketError ? `<div class="mwigm-notice"><strong>Market update failed:</strong> ${escapeHtml(state.marketError)} Cached prices remain in use when available.</div>` : "";
        const sourceNotice = `<div class="mwigm-notice mwigm-notice-info">Conversion rankings use the official market feed. Current asks are preferred; rows marked Fair or Bid are estimates because no ask was available. Rankings do not model order-book depth. Guild-token value uses its most valuable credit conversion, so shrine totals represent opportunity cost rather than a direct token purchase price.</div>`;
        const creditRows = economy.credits.filter((credit) =>
            credit.creditName.toLocaleLowerCase().includes(query) || credit.options.some((option) => option.itemName.toLocaleLowerCase().includes(query)),
        ).map((credit) => {
            const best = credit.bestOption;
            const alternatives = credit.options.filter((option) => option.available).slice(1, 4);
            return `
                <tr>
                    <td><span class="mwigm-trial-name">${escapeHtml(credit.creditName)}</span><br><span class="mwigm-subtext">${credit.options.length} conversion option${credit.options.length === 1 ? "" : "s"}</span></td>
                    <td>${best ? `<span class="mwigm-price-best">${escapeHtml(best.itemName)}</span>` : "No priced item"}</td>
                    <td>${best ? `${formatExactNumber(best.itemCount)} items → ${formatExactNumber(best.creditCount)} credits` : "--"}</td>
                    <td>${best ? `${formatCoins(best.unitPrice)}<br><span class="mwigm-price-source">${escapeHtml(best.source)}</span>` : "--"}</td>
                    <td>${best ? formatCoins(best.costPerCredit) : "--"}</td>
                    <td>${alternatives.length ? alternatives.map((option) => `${escapeHtml(option.itemName)} ${formatCoins(option.costPerCredit)}`).join("<br>") : "--"}</td>
                </tr>
            `;
        }).join("");
        const shrineSections = economy.shrineGroups.map((group) => {
            const groupMatches = group.name.toLocaleLowerCase().includes(query);
            const buffs = group.buffs.map((buff) => {
                const buffMatches = groupMatches || buff.name.toLocaleLowerCase().includes(query) ||
                    (buff.isCombat ? "combat" : "skilling").includes(query);
                const levels = buff.levels.filter((level) => {
                    const ingredients = [level.guildTokenCost ? "guild token" : "", ...level.creditCosts.map((entry) => entry.itemName)].join(" ").toLocaleLowerCase();
                    return buffMatches || ingredients.includes(query);
                });
                return { ...buff, levels };
            }).filter((buff) => buff.levels.length);
            if (!buffs.length) return "";
            const visibleLevels = buffs.flatMap((buff) => buff.levels);
            const pricedLevels = visibleLevels.filter((level) => Number.isFinite(level.incrementalCost)).length;
            const buffSummary = group.buffs.map((buff) => `${buff.isCombat ? "Combat" : "Skilling"} Lv ${buff.currentLevel}`).join(" · ");
            const rows = buffs.flatMap((buff) => buff.levels.map((level) => {
                const ingredients = [
                    level.guildTokenCost ? `${formatExactNumber(level.guildTokenCost)} Guild Token` : "",
                    ...level.creditCosts.map((entry) => `${formatExactNumber(entry.count)} ${entry.itemName}`),
                ].filter(Boolean).join(" + ") || "No currency cost";
                return `
                    <tr>
                        <td><span class="mwigm-trial-name">${buff.isCombat ? "Combat" : "Skilling"}</span><br><span class="mwigm-subtext">${escapeHtml(buff.name)} · current Lv ${buff.currentLevel}</span></td>
                        <td>Level ${level.level}${level.purchased ? ` <span class="mwigm-chip mwigm-chip-good">Purchased</span>` : ""}</td>
                        <td title="${escapeHtml(ingredients)}">${escapeHtml(ingredients)}</td>
                        <td>${Number.isFinite(level.incrementalCost) ? formatCoins(level.incrementalCost) : "--"}</td>
                        <td>${Number.isFinite(level.cumulativeCost) ? formatCoins(level.cumulativeCost) : "--"}</td>
                    </tr>
                `;
            })).join("");
            const open = query || state.expandedShrines.has(group.shrineTypeHrid) ? " open" : "";
            return `
                <details class="mwigm-shrine-group"${open}>
                    <summary data-action="toggle-shrine" data-shrine-group="${escapeHtml(group.shrineTypeHrid)}">${escapeHtml(group.name)}<span class="mwigm-shrine-summary-meta">${escapeHtml(buffSummary)} · ${pricedLevels}/${visibleLevels.length} levels priced</span></summary>
                    <div class="mwigm-shrine-table-scroll"><table class="mwigm-table mwigm-shrine-table"><thead><tr><th style="width:22%">Buff</th><th>Level</th><th style="width:30%">Currency cost</th><th>Incremental coins</th><th>Cumulative coins</th></tr></thead><tbody>${rows}</tbody></table></div>
                </details>
            `;
        }).join("");

        return `
            ${overview}
            ${definitionNotice}
            ${errorNotice}
            ${checkedNotice}
            ${sourceNotice}
            <div class="mwigm-section-title">Optimal credit conversions <span>Lowest estimated coins per guild credit</span></div>
            <table class="mwigm-table mwigm-economy-table"><thead><tr><th style="width:19%">Guild credit</th><th>Best item</th><th>Exchange</th><th>Price per item</th><th>Coins per credit</th><th>Next options</th></tr></thead><tbody>${creditRows || emptyTableRow(6)}</tbody></table>
            <div class="mwigm-section-title">Shrine level estimates <span>Incremental and cumulative opportunity cost</span></div>
            ${shrineSections || (economy.shrineGroups.length
                ? emptyState("No matching shrine levels", "Try another shrine or credit name.")
                : emptyState("Shrine levels unavailable", "Game shrine definitions have not been captured yet."))}
        `;
    }

    function renderMissing(aggregate) {
        if (!aggregate.missingMembers.length) {
            return emptyState("Full coverage", "Every current guild member has a cached profile.");
        }
        const query = state.query.toLocaleLowerCase();
        const members = aggregate.missingMembers.filter((member) => member.name.toLocaleLowerCase().includes(query));
        if (!members.length) return emptyState("No matching members", "Try another member name.");
        return `
            <div class="mwigm-notice mwigm-notice-info">Open these members' profiles from the game's Guild panel. The monitor captures the response passively; it never clicks or requests profiles for you.</div>
            <ul class="mwigm-list">${members.map((member) => `<li><span><strong>${escapeHtml(member.name)}</strong><br><span class="mwigm-subtext">${escapeHtml(Core.prettifyHrid(member.role))}</span></span><span class="mwigm-missing">Needed</span></li>`).join("")}</ul>
        `;
    }

    function coverageNotice(aggregate) {
        if (aggregate.coveredCount === aggregate.memberCount) return "";
        return `<div class="mwigm-notice mwigm-notice-info">Statistics currently use ${aggregate.coveredCount} of ${aggregate.memberCount} members. Open the Missing profiles tab for the remaining names.</div>`;
    }

    function emptyState(title, detail) {
        return `<div class="mwigm-empty"><strong>${escapeHtml(title)}</strong>${escapeHtml(detail)}</div>`;
    }

    function emptyTableRow(columns) {
        return `<tr><td class="mwigm-no-results" colspan="${columns}">No matching data</td></tr>`;
    }

    function sortSkills(skills) {
        const copy = [...skills];
        if (state.sort === "average") return copy.sort((a, b) => b.average - a.average || a.name.localeCompare(b.name));
        if (state.sort === "median") return copy.sort((a, b) => (b.median ?? -1) - (a.median ?? -1) || a.name.localeCompare(b.name));
        if (state.sort === "max") return copy.sort((a, b) => b.maxLevel - a.maxLevel || a.name.localeCompare(b.name));
        if (state.sort === "min") return copy.sort((a, b) => a.minLevel - b.minLevel || a.name.localeCompare(b.name));
        return copy.sort((a, b) => {
            if (a.skillHrid === Core.TOTAL_LEVEL_HRID) return -1;
            if (b.skillHrid === Core.TOTAL_LEVEL_HRID) return 1;
            return a.name.localeCompare(b.name);
        });
    }

    function sortMembers(members, trackingById = new Map()) {
        const copy = [...members];
        if (state.sort === "total") {
            return copy.sort((a, b) => getTotalLevel(b) - getTotalLevel(a) || a.name.localeCompare(b.name));
        }
        if (state.sort === "offline") {
            return copy.sort((a, b) => {
                const left = trackingById.get(String(a.id));
                const right = trackingById.get(String(b.id));
                return (right && right.offlineDurationMs !== null ? right.offlineDurationMs : -1) -
                    (left && left.offlineDurationMs !== null ? left.offlineDurationMs : -1) || a.name.localeCompare(b.name);
            });
        }
        if (state.sort === "missed") {
            const rank = { missed: 0, participated: 1, unknown: 2 };
            return copy.sort((a, b) => {
                const left = trackingById.get(String(a.id));
                const right = trackingById.get(String(b.id));
                return (rank[left ? left.previousWeekStatus : "unknown"] ?? 2) -
                    (rank[right ? right.previousWeekStatus : "unknown"] ?? 2) || a.name.localeCompare(b.name);
            });
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
            if (state.activeTab === "shrines") {
                hydrateEconomyDefinitions();
                void refreshMarketData();
            }
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
            case "refresh-market":
                hydrateEconomyDefinitions();
                void refreshMarketData(true);
                break;
            case "toggle-shrine": {
                const group = control.dataset.shrineGroup;
                if (control.parentElement.open) state.expandedShrines.delete(group);
                else state.expandedShrines.add(group);
                break;
            }
        }
    }

    function handlePanelInput(event) {
        if (event.target.dataset.auraMemberId) {
            setAuraAssignment(event.target.dataset.auraMemberId, event.target.value);
            render();
            return;
        }
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
        const csv = Core.toCsv(
            aggregate,
            state.skillDetails,
            state.guildTrialDetails,
            state.guildStore ? state.guildStore.auraAssignments : {},
            currentMemberTracking(aggregate),
            Core.resolveGuildWeekStart(state.guild),
        );
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

    function formatCoins(value) {
        if (!Number.isFinite(Number(value))) return "--";
        return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 }).format(Number(value));
    }

    function formatExactNumber(value) {
        return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(value) || 0);
    }

    function formatCompactDecimal(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return "--";
        return Number.isInteger(number) ? String(number) : number.toFixed(1);
    }

    function formatSignedDifference(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return "--";
        return `${number >= 0 ? "+" : ""}${formatCompactDecimal(number)}`;
    }

    function formatDelta(value) {
        if (value === null || !Number.isFinite(value)) return "--";
        if (Math.abs(value) < 0.05) return "0.0";
        return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
    }

    function formatRelativeTime(timestamp) {
        const parsed = Core.toTimestamp(timestamp);
        if (parsed === null) return "Unknown";
        const elapsed = Math.max(0, Date.now() - parsed);
        if (elapsed < 60_000) return "Just now";
        if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
        if (elapsed < Core.DAY_MS) return `${Math.floor(elapsed / 3_600_000)}h ago`;
        return `${Math.floor(elapsed / Core.DAY_MS)}d ago`;
    }

    function formatElapsedDuration(elapsed) {
        if (elapsed < 3_600_000) return `${Math.max(1, Math.floor(elapsed / 60_000))}m`;
        if (elapsed < Core.DAY_MS) return `${Math.floor(elapsed / 3_600_000)}h`;
        const days = Math.floor(elapsed / Core.DAY_MS);
        const hours = Math.floor((elapsed % Core.DAY_MS) / 3_600_000);
        return hours ? `${days}d ${hours}h` : `${days}d`;
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
