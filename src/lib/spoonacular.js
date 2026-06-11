import { extractRecipeNutrition } from "./nutrition";

const SPOONACULAR_RECIPE_SEARCH_URL =
  "https://api.spoonacular.com/recipes/complexSearch";

const DIET_REQUIREMENTS = {
  vegan: "vegan",
  vegetarian: "vegetarian",
  "gluten-free": "gluten free",
};

const INTOLERANCE_REQUIREMENTS = {
  "dairy-free": "dairy",
  "gluten-free": "gluten",
};

const EXCLUDED_INGREDIENTS = {
  halal: ["pork", "alcohol"],
  kosher: ["pork", "shellfish"],
};

const EQUIPMENT_FILTERS = {
  oven: "oven",
  stovetop: "frying pan",
  microwave: "microwave",
  "air-fryer": "air fryer",
  blender: "blender",
  "slow-cooker": "slow cooker",
};

function stripHtml(value = "") {
  return value.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function applyNumberParam(params, key, value) {
  const numberValue = Math.round(Number(value) || 0);
  if (numberValue > 0) {
    params.set(key, String(numberValue));
  }
}

function buildDietParams(dietaryRequirements = []) {
  const diets = [];
  const intolerances = [];
  const excludedIngredients = [];

  dietaryRequirements.forEach((requirement) => {
    if (DIET_REQUIREMENTS[requirement]) {
      diets.push(DIET_REQUIREMENTS[requirement]);
    }

    if (INTOLERANCE_REQUIREMENTS[requirement]) {
      intolerances.push(INTOLERANCE_REQUIREMENTS[requirement]);
    }

    if (EXCLUDED_INGREDIENTS[requirement]) {
      excludedIngredients.push(...EXCLUDED_INGREDIENTS[requirement]);
    }
  });

  return {
    diet: unique(diets).join(","),
    intolerances: unique(intolerances).join(","),
    excludeIngredients: unique(excludedIngredients).join(","),
  };
}

function buildEquipmentParam(selectedAppliances = []) {
  return unique(
    selectedAppliances.map((appliance) => EQUIPMENT_FILTERS[appliance])
  ).join(",");
}

function getSkillAdjustedReadyTime(maxTime, cookingSkill) {
  const timeLimit = Math.max(10, Number(maxTime) || 45);

  if (cookingSkill === "beginner") {
    return Math.min(timeLimit, 30);
  }

  if (cookingSkill === "intermediate") {
    return Math.min(timeLimit, 60);
  }

  return timeLimit;
}

function normalizeRecipe(recipe) {
  const nutrition = extractRecipeNutrition(recipe);

  return {
    spoonacularId: recipe.id,
    title: recipe.title,
    imageUrl: recipe.image,
    sourceUrl: recipe.sourceUrl || recipe.spoonacularSourceUrl,
    summary: stripHtml(recipe.summary).slice(0, 180),
    servings: recipe.servings,
    readyInMinutes: recipe.readyInMinutes,
    pricePerServing: Number(recipe.pricePerServing) || null,
    calories: nutrition.calories,
    protein: nutrition.protein,
    carbs: nutrition.carbs,
    fat: nutrition.fat,
  };
}

export async function fetchSpoonacularMealSuggestions({
  profile,
  filters,
  maxTime,
  recipeFilters,
  number = 6,
}) {
  const apiKey = import.meta.env.VITE_SPOONACULAR_API_KEY;

  if (!apiKey) {
    throw new Error("Missing VITE_SPOONACULAR_API_KEY in your environment.");
  }

  const dietParams = buildDietParams(profile?.dietary_requirements);
  const equipment = buildEquipmentParam(recipeFilters?.selectedAppliances);
  const maxReadyTime = getSkillAdjustedReadyTime(
    maxTime,
    recipeFilters?.cookingSkill
  );
  const params = new URLSearchParams({
    apiKey,
    number: String(number),
    type: "main course",
    instructionsRequired: "true",
    addRecipeInformation: "true",
    addRecipeNutrition: "true",
    sort: profile?.goal === "gain_muscle" ? "protein" : "healthiness",
    sortDirection: "desc",
  });

  applyNumberParam(params, "maxReadyTime", maxReadyTime);
  applyNumberParam(params, "minCalories", filters?.minCalories);
  applyNumberParam(params, "maxCalories", filters?.maxCalories);
  applyNumberParam(params, "minProtein", filters?.minProtein);
  applyNumberParam(params, "maxCarbs", filters?.maxCarbs);
  applyNumberParam(params, "maxFat", filters?.maxFat);

  if (dietParams.diet) params.set("diet", dietParams.diet);
  if (dietParams.intolerances) params.set("intolerances", dietParams.intolerances);
  if (equipment) params.set("equipment", equipment);
  if (dietParams.excludeIngredients) {
    params.set("excludeIngredients", dietParams.excludeIngredients);
  }

  const response = await fetch(`${SPOONACULAR_RECIPE_SEARCH_URL}?${params}`);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      payload.message || `Spoonacular request failed with status ${response.status}.`
    );
  }

  const budget = Number(profile?.budget) || 0;

  return (payload.results || [])
    .map(normalizeRecipe)
    .filter((recipe) => {
      const matchesNutrition = recipe.title && recipe.calories > 0;
      const matchesBudget =
        budget <= 0 ||
        !recipe.pricePerServing ||
        recipe.pricePerServing <= budget * 100;

      return matchesNutrition && matchesBudget;
    });
}
