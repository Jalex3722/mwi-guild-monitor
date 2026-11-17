"use strict";

// Tests for the skilling trial planner (Core.planSkillingTrials). Delete this file with the planner.
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../mwi-guild-monitor.user.js");

function plannerMember(id, levels, extra = {}) {
    return {
        id: String(id),
        name: `M${id}`,
        profile: { skills: Object.entries(levels).map(([skill, level]) => ({ skillHrid: `/skills/${skill}`, level })) },
        ...extra,
    };
}

function plannerTrial(skill, extra = {}) {
    return { trialHrid: `/guild_skilling/${skill}`, name: skill, skillHrid: `/skills/${skill}`, minLevel: 0, capacity: 20, signups: [], ...extra };
}

function leximinBest(levelsByMember, trialCount, capacities) {
    let best = null;
    const total = trialCount ** levelsByMember.length;
    for (let code = 0; code < total; code += 1) {
        const strengths = Array(trialCount).fill(0);
        const counts = Array(trialCount).fill(0);
        let rest = code;
        let valid = true;
        for (const levels of levelsByMember) {
            const trial = rest % trialCount;
            rest = Math.floor(rest / trialCount);
            if (levels[trial] === null || ++counts[trial] > capacities[trial]) { valid = false; break; }
            strengths[trial] += levels[trial];
        }
        if (!valid) continue;
        const sorted = strengths.sort((a, b) => a - b);
        if (!best || sorted.some((value, index) => value !== best[index]) && sorted.find((value, index) => value !== best[index]) > best[sorted.findIndex((value, index) => value !== best[index])]) best = sorted;
    }
    return best;
}

test("skilling planner evens trial strength instead of stacking best skills", () => {
    const trials = [plannerTrial("cooking"), plannerTrial("mining")];
    // Everyone is best at cooking; pure best-skill would leave mining empty.
    const members = [
        plannerMember(1, { cooking: 150, mining: 140 }),
        plannerMember(2, { cooking: 145, mining: 100 }),
        plannerMember(3, { cooking: 130, mining: 125 }),
        plannerMember(4, { cooking: 120, mining: 60 }),
    ];
    const plan = Core.planSkillingTrials({ trials, members });
    assert.equal(plan.plannedCount, 4);
    const [cooking, mining] = plan.trials;
    assert.ok(mining.plannedCount > 0);
    // Best split: cooking {2,4} = 265 vs mining {1,3} = 265.
    assert.equal(plan.weakestStrength, 265);
    assert.equal(plan.strongestStrength, 265);
    assert.deepEqual(cooking.members.map((entry) => entry.memberName).sort(), ["M2", "M4"]);
    assert.deepEqual(mining.members.map((entry) => entry.memberName).sort(), ["M1", "M3"]);
});

test("skilling planner matches an exhaustive leximin search on small guilds", () => {
    let seed = 12345;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const skills = ["cooking", "mining", "brewing"];
    for (let round = 0; round < 60; round += 1) {
        const memberCount = 3 + Math.floor(random() * 5);
        const minLevels = skills.map(() => (random() < 0.3 ? 90 : 0));
        const capacities = skills.map(() => (random() < 0.3 ? 2 : 20));
        const trials = skills.map((skill, index) => plannerTrial(skill, { minLevel: minLevels[index], capacity: capacities[index] }));
        const members = Array.from({ length: memberCount }, (_, index) => plannerMember(index + 1,
            Object.fromEntries(skills.map((skill) => [skill, 60 + Math.floor(random() * 90)]))));
        const levelsByMember = members.map((member) => skills.map((skill, index) => {
            const level = member.profile.skills.find((entry) => entry.skillHrid === `/skills/${skill}`).level;
            return level >= minLevels[index] ? level : null;
        })).filter((levels) => levels.some((level) => level !== null));
        const plan = Core.planSkillingTrials({ trials, members });
        const expected = leximinBest(levelsByMember, skills.length, capacities);
        if (!expected) continue;
        assert.deepEqual(plan.trials.map((trial) => trial.strength).sort((a, b) => a - b), expected, `round ${round}`);
        // The local search used for large guilds should seat everyone and stay close to optimal.
        const local = Core.planSkillingTrials({ trials, members, exactSearchLimit: 0 });
        assert.equal(local.plannedCount, plan.plannedCount, `round ${round} local seats`);
        assert.ok(local.weakestStrength >= expected[0] - 15, `round ${round} local weakest ${local.weakestStrength} vs ${expected[0]}`);
    }
});

test("skilling planner balances a full-size guild quickly", () => {
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const skills = ["cooking", "mining", "brewing", "tailoring"];
    const trials = skills.map((skill) => plannerTrial(skill, { capacity: 30 }));
    const members = Array.from({ length: 100 }, (_, index) => plannerMember(index + 1,
        Object.fromEntries(skills.map((skill) => [skill, 60 + Math.floor(random() * 100)]))));
    const started = Date.now();
    const plan = Core.planSkillingTrials({ trials, members });
    assert.ok(Date.now() - started < 3000);
    assert.equal(plan.plannedCount, 100);
    assert.ok(plan.trials.every((trial) => trial.plannedCount <= 30));
    assert.ok(plan.strongestStrength - plan.weakestStrength <= 50, `spread ${plan.strongestStrength - plan.weakestStrength}`);
});

test("skilling planner respects minimum levels, slot caps, and week eligibility", () => {
    const trials = [plannerTrial("cooking", { minLevel: 100, capacity: 1 }), plannerTrial("mining", { capacity: 1 })];
    const weekStart = Date.UTC(2026, 10, 13);
    const members = [
        plannerMember(1, { cooking: 150, mining: 90 }),
        plannerMember(2, { cooking: 95, mining: 140 }),
        plannerMember(3, { cooking: 99, mining: 80 }),
        plannerMember(4, { cooking: 50, mining: 50 }, { joinedAt: weekStart + 1000 }),
        { id: "5", name: "M5", profile: null },
    ];
    const plan = Core.planSkillingTrials({ trials, members, guildWeekStartAt: weekStart });
    assert.deepEqual(plan.trials[0].members.map((entry) => entry.memberName), ["M1"]);
    assert.deepEqual(plan.trials[1].members.map((entry) => entry.memberName), ["M2"]);
    const reasons = Object.fromEntries(plan.unplanned.map((entry) => [entry.memberName, entry.reason]));
    assert.deepEqual(reasons, { M3: "noOpenSlot", M4: "joinedThisWeek", M5: "missingProfile" });
    assert.ok(plan.trials[0].members.every((entry) => entry.level >= 100));
});

test("skilling planner reports signup status and suggested changes", () => {
    const trials = [
        plannerTrial("cooking", { signups: [{ memberId: "1" }, { memberId: "2" }] }),
        plannerTrial("mining", { signups: [] }),
    ];
    const members = [
        plannerMember(1, { cooking: 150, mining: 40 }),
        plannerMember(2, { cooking: 100, mining: 140 }),
        plannerMember(3, { cooking: 120, mining: 30 }),
        plannerMember(4, { cooking: 10, mining: 20 }),
    ];
    const plan = Core.planSkillingTrials({ trials, members });
    const status = Object.fromEntries(plan.trials.flatMap((trial) => trial.members.map((entry) => [entry.memberName, `${trial.name}:${entry.status}`])));
    assert.equal(status.M1, "cooking:here");
    assert.equal(status.M2, "mining:elsewhere");
    assert.match(status.M3, /:unsigned$/);
    const changes = plan.changes.map((entry) => entry.memberName);
    assert.ok(!changes.includes("M1"));
    assert.equal(plan.changes.find((entry) => entry.memberName === "M2").currentTrialName, "cooking");
    assert.equal(changes.indexOf("M2"), 0, "members signed elsewhere are listed before unsigned members");
});
