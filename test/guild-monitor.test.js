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
    assert.equal(cooking.minLevel, 40);
    assert.equal(cooking.maxLevel, 80);
    assert.deepEqual(cooking.minMembers, ["Babbage"]);
    assert.deepEqual(cooking.maxMembers, ["Ada"]);
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
    assert.equal(analysis.unsignedSkilling[0].name, "Curie");
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
