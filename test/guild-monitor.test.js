"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../mwi-guild-monitor.user.js");

const roster = Core.normalizeRoster(
    {
        1: { characterID: 1, guildRole: "leader", experience: 1200, weeklyExperience: 200 },
        2: { characterID: 2, guildRole: "officer", experience: 800, weeklyExperience: 100 },
        3: { characterID: 3, guildRole: "member", experience: 400, weeklyExperience: 50 },
    },
    {
        1: { id: 1, name: "Ada", isOnline: true },
        2: { id: 2, name: "Babbage", isOnline: false },
        3: { id: 3, name: "Curie", isOnline: false },
    },
);

const profiles = {
    1: {
        id: "1",
        name: "Ada",
        capturedAt: 1000,
        skills: [
            { skillHrid: "/skills/total_level", level: 1000, experience: 0 },
            { skillHrid: "/skills/cooking", level: 80, experience: 0 },
        ],
    },
    2: {
        id: "2",
        name: "Babbage",
        capturedAt: 2000,
        skills: [
            { skillHrid: "/skills/total_level", level: 800, experience: 0 },
            { skillHrid: "/skills/cooking", level: 40, experience: 0 },
        ],
    },
};

test("normalizes the guild roster", () => {
    assert.equal(roster.length, 3);
    assert.deepEqual(roster.map((member) => member.name), ["Ada", "Babbage", "Curie"]);
    assert.equal(roster[0].role, "leader");
    assert.equal(roster[0].isOnline, true);
});

test("calculates average, minimum, maximum, and coverage", () => {
    const result = Core.aggregateGuild(roster, profiles, {
        "/skills/cooking": { name: "Cooking" },
    });
    const cooking = result.skills.find((skill) => skill.skillHrid === "/skills/cooking");

    assert.equal(result.memberCount, 3);
    assert.equal(result.coveredCount, 2);
    assert.equal(result.coverage, 2 / 3);
    assert.equal(result.missingMembers[0].name, "Curie");
    assert.equal(cooking.average, 60);
    assert.equal(cooking.median, 60);
    assert.equal(cooking.minLevel, 40);
    assert.equal(cooking.maxLevel, 80);
    assert.deepEqual(cooking.minMembers, ["Babbage"]);
    assert.deepEqual(cooking.maxMembers, ["Ada"]);
    assert.equal(cooking.thresholdCounts[100].count, 0);
});

test("normalizes a profile response", () => {
    const profile = Core.normalizeProfile({
        sharableCharacter: { id: 7, name: "Grace" },
        characterSkills: [{ skillHrid: "/skills/foraging", level: 72, experience: 123 }],
    }, 5000);

    assert.equal(profile.id, "7");
    assert.equal(profile.name, "Grace");
    assert.equal(profile.capturedAt, 5000);
    assert.equal(profile.skills[0].level, 72);
});

test("exports quoted CSV cells", () => {
    const result = Core.aggregateGuild(
        [{ ...roster[0], name: "Ada, First" }],
        { 1: { ...profiles[1], name: "Ada, First" } },
        { "/skills/cooking": { name: "Cooking" } },
    );
    const csv = Core.toCsv(result, { "/skills/cooking": { name: "Cooking" } });

    assert.match(csv, /"Ada, First"/);
    assert.match(csv, /Cooking/);
});

test("creates snapshots and finds the previous one", () => {
    const aggregate = Core.aggregateGuild(roster, profiles);
    const first = Core.makeSnapshot({ id: 10, name: "Milk Lab" }, aggregate, 1000);
    const second = Core.makeSnapshot({ id: 10, name: "Milk Lab" }, aggregate, 2000);

    assert.equal(first.coveredCount, 2);
    assert.equal(first.skills["/skills/cooking"].average, 60);
    assert.equal(Core.getPreviousSnapshot([first, second], 3000), second);
});

test("tracks current guild-trial signups and signup levels", () => {
    const weekStart = Date.UTC(2026, 9, 23);
    const members = Core.aggregateGuild(
        roster.map((member, index) => ({
            ...member,
            signedUpSkillingTrialHrid: index < 2 ? "/guild_skilling/cooking" : "",
            signedUpCombatTrialHrid: index === 0 ? "/guild_combat/badger" : "",
            signedUpCombatRoleHrid: index === 0 ? "/combat_roles/tank" : "",
            signupWeekStartAt: weekStart,
        })),
        profiles,
    );
    const analysis = Core.analyzeTrials({
        aggregate: members,
        weeklyTrialSet: {
            skillHrids: ["/guild_skilling/cooking", "/guild_skilling/mining"],
            combatHrids: ["/guild_combat/badger"],
        },
        trialDetails: {
            "/guild_skilling/cooking": { kind: "skilling", skillHrid: "/skills/cooking" },
            "/guild_skilling/mining": { kind: "skilling", skillHrid: "/skills/mining" },
            "/guild_combat/badger": { kind: "combat" },
        },
        signupLevels: {
            1: { skillingTrialLevel: 80, combatLevel: 145 },
            2: { skillingTrialLevel: 40 },
        },
        guildWeekStartAt: weekStart,
        now: weekStart + 86_400_000,
    });

    assert.equal(analysis.skillingSignedCount, 2);
    assert.equal(analysis.combatSignedCount, 1);
    assert.equal(analysis.skilling[0].averageLevel, 60);
    assert.equal(analysis.combat[0].roles["/combat_roles/tank"], 1);
    assert.equal(analysis.anyTrialSignedCount, 2);
    assert.equal(analysis.unsignedTrials.length, 1);
    assert.equal(analysis.unsignedTrials[0].name, "Curie");
});

test("tracks high-level members missing a specific skilling trial", () => {
    const highLevelRoster = [
        { id: "1", name: "Ada", role: "leader", signedUpSkillingTrialHrid: "cook", signedUpCombatTrialHrid: "badger" },
        { id: "2", name: "Babbage", role: "officer", signedUpSkillingTrialHrid: "mine", signedUpCombatTrialHrid: "" },
        { id: "3", name: "Curie", role: "member", signedUpSkillingTrialHrid: "", signedUpCombatTrialHrid: "badger" },
        { id: "4", name: "Noether", role: "member", signedUpSkillingTrialHrid: "", signedUpCombatTrialHrid: "" },
    ];
    const highLevelProfiles = {
        1: { id: "1", name: "Ada", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 151 }] },
        2: { id: "2", name: "Babbage", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 140 }] },
        3: { id: "3", name: "Curie", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 130 }] },
        4: { id: "4", name: "Noether", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 125 }] },
    };
    const aggregate = Core.aggregateGuild(highLevelRoster, highLevelProfiles);
    const analysis = Core.analyzeTrials({
        aggregate,
        weeklyTrialSet: { skillHrids: ["cook"], combatHrids: ["badger"] },
        trialDetails: {
            cook: { skillHrid: "/skills/cooking" },
            badger: { kind: "combat", name: "Badger" },
        },
    });
    const cooking = aggregate.skills.find((skill) => skill.skillHrid === "/skills/cooking");
    const cookingGap = analysis.highLevelSkillGaps.find((gap) => gap.skillHrid === "/skills/cooking");

    assert.equal(cooking.thresholdCounts[100].count, 4);
    assert.equal(cooking.thresholdCounts[125].count, 3);
    assert.equal(cooking.thresholdCounts[150].count, 1);
    assert.deepEqual(cooking.maxMembers, ["Ada"]);
    assert.deepEqual(cookingGap.members.map((member) => member.memberName), ["Babbage", "Curie"]);
    assert.deepEqual(analysis.unsignedTrials.map((member) => member.name), ["Noether"]);
    assert.equal(analysis.recommendations.some((entry) => entry.memberName === "Curie"), false);
    assert.equal(analysis.recommendations.some((entry) => entry.memberName === "Noether"), true);
});

test("balances skilling recommendations while respecting minimum levels", () => {
    const recommendationRoster = [
        { id: "1", name: "Ada", role: "leader", signedUpSkillingTrialHrid: "/guild_skilling/cooking" },
        { id: "2", name: "Babbage", role: "officer", signedUpSkillingTrialHrid: "/guild_skilling/cooking" },
        { id: "3", name: "Curie", role: "member", signedUpSkillingTrialHrid: "/guild_skilling/mining" },
        { id: "4", name: "Noether", role: "member", signedUpSkillingTrialHrid: "" },
    ];
    const recommendationProfiles = {
        1: { id: "1", name: "Ada", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 100 }, { skillHrid: "/skills/mining", level: 70 }] },
        2: { id: "2", name: "Babbage", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 90 }, { skillHrid: "/skills/mining", level: 95 }] },
        3: { id: "3", name: "Curie", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 80 }, { skillHrid: "/skills/mining", level: 100 }] },
        4: { id: "4", name: "Noether", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 96 }, { skillHrid: "/skills/mining", level: 91 }] },
    };
    const aggregate = Core.aggregateGuild(recommendationRoster, recommendationProfiles);
    const analysis = Core.analyzeTrials({
        aggregate,
        weeklyTrialSet: { skillHrids: ["cook", "mine"], combatHrids: [] },
        trialDetails: {
            cook: { skillHrid: "/skills/cooking" },
            mine: { skillHrid: "/skills/mining" },
        },
        trialMinLevels: JSON.stringify({ cook: 90, mine: 90 }),
    });
    const babbage = analysis.recommendations.find((entry) => entry.memberName === "Babbage");
    const noether = analysis.recommendations.find((entry) => entry.memberName === "Noether");

    assert.equal(babbage.recommendedTrialHrid, "mine");
    assert.equal(babbage.isAligned, false);
    assert.equal(noether.recommendedTrialHrid, "cook");
    assert.equal(noether.currentTrialName, "Not signed up");
});

test("tracks exact-one aura coverage for each combat trial", () => {
    const combatRoster = [
        { id: "1", name: "Ada", role: "leader", signedUpCombatTrialHrid: "badger" },
        { id: "2", name: "Babbage", role: "officer", signedUpCombatTrialHrid: "badger" },
        { id: "3", name: "Curie", role: "member", signedUpCombatTrialHrid: "badger" },
        { id: "4", name: "Noether", role: "member", signedUpCombatTrialHrid: "" },
    ];
    const aggregate = Core.aggregateGuild(combatRoster, {});
    const analysis = Core.analyzeTrials({
        aggregate,
        weeklyTrialSet: { skillHrids: [], combatHrids: ["badger"] },
        trialDetails: { badger: { kind: "combat", name: "Badger" } },
        auraAssignments: {
            1: { auraHrid: "/abilities/speed_aura" },
            2: { auraHrid: "/abilities/guardian_aura" },
            3: { auraHrid: "/abilities/speed_aura" },
            4: { auraHrid: "/abilities/mystic_aura" },
        },
    });
    const badger = analysis.combat[0];
    const speed = badger.auraCoverage.find((aura) => aura.hrid === "/abilities/speed_aura");
    const guardian = badger.auraCoverage.find((aura) => aura.hrid === "/abilities/guardian_aura");
    const mystic = badger.auraCoverage.find((aura) => aura.hrid === "/abilities/mystic_aura");
    const noether = analysis.auraTracking.find((entry) => entry.memberName === "Noether");

    assert.equal(speed.status, "duplicate");
    assert.deepEqual(speed.members.map((member) => member.memberName), ["Ada", "Curie"]);
    assert.equal(guardian.status, "covered");
    assert.equal(mystic.status, "missing");
    assert.equal(badger.auraCoveredCount, 1);
    assert.equal(noether.status, "unsigned");
});

test("includes desired aura in CSV exports", () => {
    const aggregate = Core.aggregateGuild([roster[0]], profiles);
    const csv = Core.toCsv(aggregate, {}, {}, {
        1: { auraHrid: "/abilities/critical_aura" },
    });

    assert.match(csv, /Desired Aura/);
    assert.match(csv, /Critical Aura/);
});

test("flags only known offline durations of at least three days", () => {
    const now = Date.UTC(2026, 9, 26, 12);
    const members = [
        { id: "1", name: "Online", isOnline: true, lastActiveAt: now - 10 * Core.DAY_MS },
        { id: "2", name: "Recent", isOnline: false, lastActiveAt: now - 2 * Core.DAY_MS },
        { id: "3", name: "Inactive", isOnline: false, lastActiveAt: now - 3 * Core.DAY_MS },
        { id: "4", name: "Private", isOnline: false, hideOnlineStatus: true, lastActiveAt: now - 8 * Core.DAY_MS },
    ];
    const tracking = Core.buildMemberTracking(Core.aggregateGuild(members, {}), {}, null, now);
    const byName = Object.fromEntries(tracking.map((entry) => [entry.memberName, entry]));

    assert.equal(byName.Online.offlineDurationMs, null);
    assert.equal(byName.Recent.offlineThreeDays, false);
    assert.equal(byName.Inactive.offlineDurationMs, 3 * Core.DAY_MS);
    assert.equal(byName.Inactive.offlineThreeDays, true);
    assert.equal(byName.Private.offlineDurationMs, null);
    assert.equal(byName.Private.offlineThreeDays, false);
});

test("stores weekly trial participation and reports previous-week misses", () => {
    const currentWeek = Date.UTC(2026, 9, 23);
    const previousWeek = currentWeek - 7 * Core.DAY_MS;
    const priorAggregate = Core.aggregateGuild([
        { id: "1", name: "Skiller", signedUpSkillingTrialHrid: "cooking", signupWeekStartAt: previousWeek },
        { id: "2", name: "Fighter", signedUpCombatTrialHrid: "badger", signupWeekStartAt: previousWeek },
        { id: "3", name: "Absent", signupWeekStartAt: previousWeek },
    ], {});
    const history = Core.recordWeeklyTrialParticipation({}, priorAggregate, previousWeek, previousWeek + Core.DAY_MS);
    const currentAggregate = Core.aggregateGuild([
        ...priorAggregate.members,
        { id: "4", name: "Not Observed" },
    ], {});
    const tracking = Core.buildMemberTracking(currentAggregate, history, currentWeek, currentWeek + Core.DAY_MS);
    const status = Object.fromEntries(tracking.map((entry) => [entry.memberName, entry.previousWeekStatus]));

    assert.equal(status.Skiller, "participated");
    assert.equal(status.Fighter, "participated");
    assert.equal(status.Absent, "missed");
    assert.equal(status["Not Observed"], "unknown");
});

test("includes offline and prior-week status in CSV exports", () => {
    const aggregate = Core.aggregateGuild([roster[1]], profiles);
    const csv = Core.toCsv(aggregate, {}, {}, {}, [{
        memberId: "2",
        offlineDurationMs: 4 * Core.DAY_MS,
        offlineThreeDays: true,
        previousWeekStatus: "missed",
    }]);

    assert.match(csv, /Offline Days,Offline 3\+ Days,Previous Week Trial/);
    assert.match(csv, /4\.0,Yes,Missed/);
});

test("ranks guild-credit conversions and prices shrine levels", () => {
    const economy = Core.analyzeGuildEconomy({
        itemDetails: {
            "/items/apple": {
                name: "Apple",
                guildCreditConversions: [{ creditItemHrid: "/items/green_credit", itemCount: 10, creditCount: 5 }],
            },
            "/items/log": {
                name: "Log",
                guildCreditConversions: [{ creditItemHrid: "/items/green_credit", itemCount: 4, creditCount: 4 }],
            },
            "/items/gem": {
                name: "Gem",
                guildCreditConversions: [{ creditItemHrid: "/items/purple_credit", itemCount: 2, creditCount: 1 }],
            },
            "/items/green_credit": { name: "Green Guild Credit" },
            "/items/purple_credit": { name: "Purple Guild Credit" },
            "/items/guild_token": {
                name: "Guild Token",
                guildCreditConversions: [
                    { creditItemHrid: "/items/green_credit", guildTokenCount: 1, creditCount: 10 },
                    { creditItemHrid: "/items/purple_credit", guildTokenCount: 1, creditCount: 2 },
                ],
            },
        },
        marketData: {
            marketData: {
                "/items/apple": { 0: { a: 20, b: 18 } },
                "/items/log": { 0: { a: 30, b: 28 } },
                "/items/gem": { 0: { a: 50, b: 45 } },
            },
        },
        guildBuffDetails: {
            "/guild_buffs/force": {
                name: "Force Shrine",
                isCombat: true,
                levelCosts: [
                    null,
                    { guildTokenCost: 2, creditCosts: [{ itemHrid: "/items/green_credit", count: 3 }] },
                    { guildTokenCost: 0, creditCosts: [{ itemHrid: "/items/purple_credit", count: 4 }] },
                ],
            },
        },
        guildBuffLevels: { "/guild_buffs/force": 1 },
    });
    const green = economy.credits.find((credit) => credit.creditHrid === "/items/green_credit");
    const force = economy.shrines[0];

    assert.equal(green.bestOption.itemName, "Log");
    assert.equal(green.bestOption.costPerCredit, 30);
    assert.equal(economy.creditValues["/items/purple_credit"], 100);
    assert.equal(economy.guildTokenValue, 300);
    assert.equal(force.currentLevel, 1);
    assert.equal(force.levels[0].incrementalCost, 690);
    assert.equal(force.levels[0].purchased, true);
    assert.equal(force.levels[1].incrementalCost, 400);
    assert.equal(force.levels[1].cumulativeCost, 1090);
});

test("suggests first and second trial skills relative to guild medians", () => {
    const members = [
        { id: "1", name: "Ada", signedUpSkillingTrialHrid: "cook" },
        { id: "2", name: "Babbage", signedUpSkillingTrialHrid: "mine" },
        { id: "3", name: "Curie", signedUpSkillingTrialHrid: "" },
    ];
    const memberProfiles = {
        1: { id: "1", name: "Ada", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 150 }, { skillHrid: "/skills/mining", level: 100 }] },
        2: { id: "2", name: "Babbage", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 100 }, { skillHrid: "/skills/mining", level: 150 }] },
        3: { id: "3", name: "Curie", capturedAt: 1, skills: [{ skillHrid: "/skills/cooking", level: 120 }, { skillHrid: "/skills/mining", level: 120 }] },
    };
    const aggregate = Core.aggregateGuild(members, memberProfiles);
    const analysis = Core.analyzeTrials({
        aggregate,
        weeklyTrialSet: { skillHrids: ["cook", "mine"], combatHrids: [] },
        trialDetails: {
            cook: { skillHrid: "/skills/cooking" },
            mine: { skillHrid: "/skills/mining" },
        },
    });
    const ada = analysis.medianSuggestions.find((entry) => entry.memberName === "Ada");
    const babbage = analysis.medianSuggestions.find((entry) => entry.memberName === "Babbage");

    assert.equal(aggregate.skills.find((skill) => skill.skillHrid === "/skills/cooking").median, 120);
    assert.equal(ada.first.trialHrid, "cook");
    assert.equal(ada.first.medianDifference, 30);
    assert.equal(ada.second.trialHrid, "mine");
    assert.equal(babbage.first.trialHrid, "mine");
    assert.equal(babbage.second.trialHrid, "cook");
});
