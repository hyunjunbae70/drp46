export const GOAL_OPTIONS = [
  {
    id: "lose_weight",
    label: "Lose weight",
    calorieAdjustment: -500,
    proteinPerKg: 1.8,
    fatRatio: 0.25,
  },
  {
    id: "gain_muscle",
    label: "Gain muscle",
    calorieAdjustment: 300,
    proteinPerKg: 2,
    fatRatio: 0.25,
  },
  {
    id: "maintenance",
    label: "Maintenance",
    calorieAdjustment: 0,
    proteinPerKg: 1.4,
    fatRatio: 0.3,
  },
];

export const ACTIVITY_LEVELS = [
  { id: "sedentary", label: "Sedentary", factor: 1.2 },
  { id: "light", label: "Lightly active", factor: 1.375 },
  { id: "moderate", label: "Moderately active", factor: 1.55 },
  { id: "active", label: "Active", factor: 1.725 },
];

const DEFAULT_GOAL = "maintenance";
const DEFAULT_ACTIVITY_LEVEL = "moderate";

function getGoal(goalId) {
  return GOAL_OPTIONS.find((goal) => goal.id === goalId) || GOAL_OPTIONS[2];
}

function getActivityLevel(activityLevelId) {
  return (
    ACTIVITY_LEVELS.find((level) => level.id === activityLevelId) ||
    ACTIVITY_LEVELS[2]
  );
}

function roundToWhole(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

export function getGoalLabel(goalId) {
  return getGoal(goalId || DEFAULT_GOAL).label;
}

export function getActivityLabel(activityLevelId) {
  return getActivityLevel(activityLevelId || DEFAULT_ACTIVITY_LEVEL).label;
}

export function isNutritionProfileComplete(profile) {
  return Boolean(
    Number(profile?.weight_kg) > 0 &&
      Number(profile?.height_cm) > 0 &&
      Number(profile?.age) > 0 &&
      profile?.goal &&
      profile?.activity_level
  );
}

export function calculateDailyTargets(profile) {
  if (!isNutritionProfileComplete(profile)) return null;

  const weightKg = Number(profile.weight_kg);
  const heightCm = Number(profile.height_cm);
  const age = Number(profile.age);
  const goal = getGoal(profile.goal);
  const activityLevel = getActivityLevel(profile.activity_level);
  const estimatedBmr = 10 * weightKg + 6.25 * heightCm - 5 * age - 78;
  const calories = Math.max(
    1200,
    Math.round((estimatedBmr * activityLevel.factor + goal.calorieAdjustment) / 10) * 10
  );
  const protein = Math.round(weightKg * goal.proteinPerKg);
  const fat = Math.round((calories * goal.fatRatio) / 9);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));

  return {
    calories,
    protein,
    carbs,
    fat,
  };
}

export function sumMealNutrition(meals) {
  return meals.reduce(
    (total, meal) => ({
      calories: total.calories + Number(meal.calories || 0),
      protein: total.protein + Number(meal.protein_g || 0),
      carbs: total.carbs + Number(meal.carbs_g || 0),
      fat: total.fat + Number(meal.fat_g || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

export function getRemainingNutrition(targets, consumed) {
  if (!targets) return null;

  return {
    calories: Math.max(0, targets.calories - consumed.calories),
    protein: Math.max(0, targets.protein - consumed.protein),
    carbs: Math.max(0, targets.carbs - consumed.carbs),
    fat: Math.max(0, targets.fat - consumed.fat),
  };
}

export function buildMealMacroFilters(targets, consumed, goalId) {
  const remaining = getRemainingNutrition(targets, consumed);
  if (!remaining) return null;

  if (remaining.calories < 150 || remaining.carbs < 5 || remaining.fat < 3) {
    return null;
  }

  const mealShare = goalId === "gain_muscle" ? 0.4 : 0.35;
  const maxCalories = Math.min(remaining.calories, targets.calories * mealShare, 900);
  const maxCarbs = Math.min(remaining.carbs, targets.carbs * 0.45);
  const maxFat = Math.min(remaining.fat, targets.fat * 0.45);
  const minCalories = Math.min(Math.max(150, maxCalories * 0.45), maxCalories);
  const minProtein =
    goalId === "maintenance"
      ? Math.min(10, remaining.protein)
      : Math.min(Math.max(15, targets.protein * 0.2), Math.max(0, remaining.protein));

  return {
    minCalories: roundToWhole(minCalories),
    maxCalories: roundToWhole(maxCalories),
    minProtein: roundToWhole(minProtein),
    maxCarbs: roundToWhole(maxCarbs),
    maxFat: roundToWhole(maxFat),
  };
}

export function parseNutritionValue(value) {
  if (typeof value === "number") return value;
  if (!value) return 0;

  const parsed = Number.parseFloat(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function extractRecipeNutrition(recipe) {
  const nutrients = recipe?.nutrition?.nutrients || [];
  const findNutrient = (name) =>
    nutrients.find((nutrient) => nutrient.name?.toLowerCase() === name);

  return {
    calories: parseNutritionValue(
      findNutrient("calories")?.amount ?? recipe?.calories
    ),
    protein: parseNutritionValue(
      findNutrient("protein")?.amount ?? recipe?.protein
    ),
    carbs: parseNutritionValue(
      findNutrient("carbohydrates")?.amount ?? recipe?.carbs
    ),
    fat: parseNutritionValue(findNutrient("fat")?.amount ?? recipe?.fat),
  };
}
