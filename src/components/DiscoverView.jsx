import { useMemo, useState, useEffect } from "react";
import PropTypes from "prop-types";
import { supabase } from "../lib/supabase";
import { trackStep, completeJourney, persistJourney } from "../analytics";

const COOKING_SKILL_OPTIONS = [
  { id: "any",          label: "Any skill level" },
  { id: "beginner",     label: "Beginner"        },
  { id: "intermediate", label: "Intermediate"    },
  { id: "advanced",     label: "Advanced"        },
];

const APPLIANCE_OPTIONS = [
  { id: "oven",        label: "Oven"        },
  { id: "stovetop",    label: "Stovetop"    },
  { id: "microwave",   label: "Microwave"   },
  { id: "air-fryer",   label: "Air fryer"   },
  { id: "blender",     label: "Blender"     },
  { id: "slow-cooker", label: "Slow cooker" },
];

const DIETARY_OPTIONS = [
  { id: "vegan",       label: "Vegan"       },
  { id: "vegetarian",  label: "Vegetarian"  },
  { id: "gluten-free", label: "Gluten-Free" },
  { id: "dairy-free",  label: "Dairy-Free"  },
  { id: "halal",       label: "Halal"       },
  { id: "kosher",      label: "Kosher"      },
];

const GUEST_FAVORITES_KEY = "nutrisupport_guest_favourites";

const EMPTY_RECIPE_FORM = {
  title: "", description: "", prepTimeMinutes: 30, costEstimate: 5, servings: 2,
  dietaryTags: [], cookingSkill: "beginner", appliancesNeeded: [],
  ingredientsText: "", instructionsText: "",
};

function formatMinutes(m) { return m ? `${m} min` : "—"; }
function formatCost(c) { return c ? `£${Number(c).toFixed(2)}` : null; }

function readStoredIds(key) {
  try { return JSON.parse(window.localStorage.getItem(key) || "[]"); } catch { return []; }
}
function writeStoredIds(key, ids) {
  window.localStorage.setItem(key, JSON.stringify(ids));
}

function linesFromJsonList(items) {
  if (!Array.isArray(items)) return "";
  return items.map((i) => (typeof i === "string" ? i : i?.original || i?.step || "")).filter(Boolean).join("\n");
}

function parseLines(val) {
  return val.split("\n").map((l) => l.trim()).filter(Boolean);
}

function normalizeRecipe(row) {
  return {
    ...row,
    image: row.image_url,
    readyInMinutes: row.ready_in_minutes || row.prep_time_minutes,
    estimatedCost: row.cost_estimate == null ? null : Number(row.cost_estimate),
    cookingSkill: row.cooking_skill,
    appliancesNeeded: row.appliances_needed || [],
    dietaryTags: row.dietary_tags || [],
    extendedIngredients: row.ingredients || [],
    instructionSteps: row.instructions || [],
    isUserSubmitted: row.is_user_submitted || false,
    ownerId: row.user_id,
  };
}

function hasBudgetLimit(profile) {
  return profile?.budget !== undefined && profile?.budget !== null && profile.budget !== "";
}

function isMissingPersistenceTable(err) {
  return err?.code === "PGRST205" || err?.message?.includes("schema cache");
}

function recipeToForm(recipe) {
  if (!recipe) return EMPTY_RECIPE_FORM;
  return {
    title: recipe.title || "",
    description: recipe.description || "",
    prepTimeMinutes: recipe.prep_time_minutes || recipe.readyInMinutes || 30,
    costEstimate: recipe.cost_estimate == null ? 5 : Number(recipe.cost_estimate),
    servings: recipe.servings || 2,
    dietaryTags: recipe.dietary_tags || recipe.dietaryTags || [],
    cookingSkill: recipe.cooking_skill || recipe.cookingSkill || "beginner",
    appliancesNeeded: recipe.appliances_needed || recipe.appliancesNeeded || [],
    ingredientsText: linesFromJsonList(recipe.ingredients || recipe.extendedIngredients),
    instructionsText: linesFromJsonList(recipe.instructions || recipe.instructionSteps),
  };
}

function buildRecipePayload(formData, userId) {
  return {
    title: formData.title.trim(),
    description: formData.description.trim() || null,
    prep_time_minutes: Math.max(1, Number(formData.prepTimeMinutes) || 1),
    ready_in_minutes: Math.max(1, Number(formData.prepTimeMinutes) || 1),
    cost_estimate: Math.max(0, Number(formData.costEstimate) || 0),
    servings: Math.max(1, Number(formData.servings) || 1),
    dietary_tags: formData.dietaryTags,
    cooking_skill: formData.cookingSkill,
    appliances_needed: formData.appliancesNeeded,
    ingredients: parseLines(formData.ingredientsText).map((l) => ({ original: l })),
    instructions: parseLines(formData.instructionsText).map((l, i) => ({ number: i + 1, step: l })),
    user_id: userId,
    is_user_submitted: true,
  };
}

// ─── Recipe editor form ────────────────────────────────────────────────────────

function RecipeEditor({ formData, isEditing, loading, message, onCancel, onChange, onSubmit, onToggleAppliance, onToggleDietaryTag }) {
  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900">{isEditing ? "Edit recipe" : "Add your recipe"}</h3>
          <p className="text-sm text-gray-500">Only visible in your own recommendations.</p>
        </div>
        <button type="button" onClick={onCancel} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Cancel</button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1 md:col-span-2">
          <label className="block text-sm font-semibold text-gray-700">Title</label>
          <input required value={formData.title} onChange={(e) => onChange("title", e.target.value)}
            className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-emerald-500 focus:outline-none" placeholder="Lentil pasta bowl" />
        </div>
        <div className="space-y-1 md:col-span-2">
          <label className="block text-sm font-semibold text-gray-700">Description</label>
          <textarea value={formData.description} onChange={(e) => onChange("description", e.target.value)} rows="2"
            className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-emerald-500 focus:outline-none" placeholder="A quick, filling weeknight meal." />
        </div>
        <div className="space-y-1">
          <label className="block text-sm font-semibold text-gray-700">Prep time (min)</label>
          <input type="number" min="1" required value={formData.prepTimeMinutes} onChange={(e) => onChange("prepTimeMinutes", Number(e.target.value))}
            className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-emerald-500 focus:outline-none" />
        </div>
        <div className="space-y-1">
          <label className="block text-sm font-semibold text-gray-700">Cost per serving (£)</label>
          <input type="number" min="0" step="0.01" required value={formData.costEstimate} onChange={(e) => onChange("costEstimate", Number(e.target.value))}
            className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-emerald-500 focus:outline-none" />
        </div>
        <div className="space-y-1">
          <label className="block text-sm font-semibold text-gray-700">Servings</label>
          <input type="number" min="1" required value={formData.servings} onChange={(e) => onChange("servings", Number(e.target.value))}
            className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-emerald-500 focus:outline-none" />
        </div>
        <div className="space-y-1">
          <label className="block text-sm font-semibold text-gray-700">Cooking skill</label>
          <select value={formData.cookingSkill} onChange={(e) => onChange("cookingSkill", e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm focus:border-emerald-500 focus:outline-none">
            {COOKING_SKILL_OPTIONS.filter((o) => o.id !== "any").map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1 md:col-span-2">
          <span className="block text-sm font-semibold text-gray-700">Dietary tags</span>
          <div className="flex flex-wrap gap-2">
            {DIETARY_OPTIONS.map((o) => (
              <button key={o.id} type="button" onClick={() => onToggleDietaryTag(o.id)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${formData.dietaryTags.includes(o.id) ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1 md:col-span-2">
          <span className="block text-sm font-semibold text-gray-700">Appliances</span>
          <div className="flex flex-wrap gap-2">
            {APPLIANCE_OPTIONS.map((o) => (
              <button key={o.id} type="button" onClick={() => onToggleAppliance(o.id)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${formData.appliancesNeeded.includes(o.id) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1 md:col-span-2">
          <label className="block text-sm font-semibold text-gray-700">Ingredients (one per line)</label>
          <textarea required value={formData.ingredientsText} onChange={(e) => onChange("ingredientsText", e.target.value)} rows="5"
            className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-emerald-500 focus:outline-none"
            placeholder={"1 tin chickpeas\n1 tbsp olive oil\n2 handfuls spinach"} />
        </div>
        <div className="space-y-1 md:col-span-2">
          <label className="block text-sm font-semibold text-gray-700">Instructions (one step per line)</label>
          <textarea required value={formData.instructionsText} onChange={(e) => onChange("instructionsText", e.target.value)} rows="5"
            className="w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-emerald-500 focus:outline-none"
            placeholder={"Warm the oil in a pan.\nAdd chickpeas and cook for 5 minutes.\nFold in spinach and serve."} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button type="submit" disabled={loading}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
          {loading ? "Saving…" : isEditing ? "Save recipe" : "Add recipe"}
        </button>
        {message && <p className="text-sm text-gray-600">{message}</p>}
      </div>
    </form>
  );
}

// ─── Recipe detail view ────────────────────────────────────────────────────────

function RecipeDetail({
  recipeId,
  userId,
  savedMealIds,
  isGuest,
  session,
  onBack,
  backLabel = "Back to recipes",
  onToggleFavourite,
  onEdit,
  onDelete,
}) {
  const [recipe, setRecipe]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    let live = true;
    setLoading(true); setError(""); setRecipe(null);
    supabase.from("recipes").select("*").eq("id", recipeId).single()
      .then(({ data, error: e }) => {
        if (!live) return;
        if (e) setError(e.message || "Could not load recipe.");
        else setRecipe(normalizeRecipe(data));
        setLoading(false);
      });
    return () => { live = false; };
  }, [recipeId]);

  if (loading) return <div className="flex justify-center py-16"><p className="animate-pulse text-sm text-gray-400">Loading…</p></div>;
  if (error)   return <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
  if (!recipe) return null;

  const steps = recipe.instructionSteps?.length > 0
    ? recipe.instructionSteps.map((s) => s.step || s)
    : [];

  return (
    <div className="space-y-6">
      <button type="button" onClick={onBack}
        className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50">
        ← {backLabel}
      </button>

      <article className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1">
              {recipe.dietaryTags.map((tag) => (
                <span key={tag} className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-emerald-700">{tag}</span>
              ))}
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">{recipe.title}</h1>
            {recipe.description && <p className="text-base leading-7 text-gray-600">{recipe.description}</p>}
          </div>
          {recipe.image && (
            <img src={recipe.image} alt={recipe.title} className="aspect-[4/3] w-full rounded-xl object-cover shadow-sm" />
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Ready in",     value: formatMinutes(recipe.readyInMinutes) },
            { label: "Servings",     value: recipe.servings || "Flexible"        },
            { label: "Est. cost",    value: formatCost(recipe.estimatedCost) || "Not listed" },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{item.label}</p>
              <p className="mt-1 text-lg font-bold text-gray-900">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onToggleFavourite(recipe.id)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${savedMealIds.includes(recipe.id) ? "bg-rose-50 text-rose-700 hover:bg-rose-100" : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}>
            {savedMealIds.includes(recipe.id) ? "Favourited" : "Save favourite"}
          </button>
          {recipe.ownerId === userId && (
            <>
              <button type="button" onClick={() => onEdit(recipe)}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                Edit
              </button>
              <button type="button" onClick={() => onDelete(recipe)}
                className="rounded-lg bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100">
                Delete
              </button>
            </>
          )}
        </div>

        {recipe.extendedIngredients?.length > 0 && (
          <section>
            <h2 className="mb-3 text-xl font-bold text-gray-900">Ingredients</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {recipe.extendedIngredients.map((ing, i) => (
                <li key={i} className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">
                  {ing.original || ing}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="mb-3 text-xl font-bold text-gray-900">Instructions</h2>
          {steps.length > 0 ? (
            <ol className="space-y-2">
              {steps.map((step, i) => (
                <li key={i} className="flex gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">{i + 1}</span>
                  <span className="text-sm leading-6 text-gray-700">{step}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="rounded-xl border border-dashed border-gray-200 bg-white p-5 text-sm text-gray-500">
              No step-by-step instructions yet.
            </p>
          )}
        </section>
      </article>
    </div>
  );
}

// ─── Main DiscoverView ─────────────────────────────────────────────────────────

export default function DiscoverView({ profile, session, isGuest, externalRecipeId = null,
  onExternalBack, backLabel = "Back to recipes" }) {
  const userId = session?.user?.id;

  const [maxTime, setMaxTime]                       = useState(45);
  const [cookingSkill, setCookingSkill]             = useState("any");
  const [selectedAppliances, setSelectedAppliances] = useState([]);
  const [showFilters, setShowFilters]               = useState(false);

  const [recipes, setRecipes]           = useState([]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState("");
  const [refreshToken, setRefreshToken] = useState(0);

  const [savedMealIds, setSavedMealIds] = useState([]);
  const [saveMessage, setSaveMessage]   = useState("");

  const [activeTab, setActiveTab]               = useState("all");
  const [selectedRecipeId, setSelectedRecipeId] = useState(null);
  const activeRecipeId = externalRecipeId || selectedRecipeId;

  const [showEditor, setShowEditor]               = useState(false);
  const [editingRecipe, setEditingRecipe]         = useState(null);
  const [recipeForm, setRecipeForm]               = useState({ ...EMPTY_RECIPE_FORM });
  const [formLoading, setFormLoading]             = useState(false);
  const [formMessage, setFormMessage]             = useState("");

  // fetch recipes
  useEffect(() => {
    let live = true;
    async function load() {
      setLoading(true); setError("");
      try {
        let q = supabase.from("recipes").select("*")
          .order("health_score", { ascending: false, nullsFirst: false })
          .limit(60)
          .lte("prep_time_minutes", maxTime);
        if (hasBudgetLimit(profile)) q = q.lte("cost_estimate", Number(profile.budget));
        const dietary = profile?.dietary_requirements || [];
        if (dietary.length > 0) q = q.contains("dietary_tags", dietary);
        if (cookingSkill !== "any") q = q.eq("cooking_skill", cookingSkill);
        if (selectedAppliances.length > 0) q = q.contains("appliances_needed", selectedAppliances);
        const { data, error: e } = await q;
        if (e) throw e;
        if (live) setRecipes((data || []).map(normalizeRecipe));
      } catch (err) {
        if (live) { setError(err.message || "Could not load recipes."); setRecipes([]); }
      } finally {
        if (live) setLoading(false);
      }
    }
    load();
    return () => { live = false; };
  }, [profile, maxTime, cookingSkill, selectedAppliances, refreshToken]);

  // fetch favourites
  useEffect(() => {
    if (isGuest) { setSavedMealIds(readStoredIds(GUEST_FAVORITES_KEY)); return; }
    if (!userId) { setSavedMealIds([]); return; }
    supabase.from("user_favourite_recipes").select("recipe_id").eq("user_id", userId)
      .then(({ data, error: e }) => {
        if (!e) setSavedMealIds((data || []).map((r) => r.recipe_id));
      });
  }, [isGuest, userId]);

  const visibleRecipes = useMemo(() => recipes.filter((r) => {
    if (activeTab === "favourites") return savedMealIds.includes(r.id);
    if (activeTab === "mine") return r.ownerId === userId;
    return true;
  }), [recipes, savedMealIds, activeTab, userId]);

  const toggleFavourite = async (recipeId) => {
    const isSaved = savedMealIds.includes(recipeId);
    const next = isSaved ? savedMealIds.filter((id) => id !== recipeId) : [...savedMealIds, recipeId];
    setSavedMealIds(next);
    setSaveMessage(isSaved ? "Removed from favourites." : "Saved to favourites.");
    if (isGuest) { writeStoredIds(GUEST_FAVORITES_KEY, next); return; }
    if (!userId) return;
    const { error: e } = isSaved
      ? await supabase.from("user_favourite_recipes").delete().eq("user_id", userId).eq("recipe_id", recipeId)
      : await supabase.from("user_favourite_recipes").upsert({ user_id: userId, recipe_id: recipeId });
    if (e) {
      setSavedMealIds(savedMealIds);
      setSaveMessage(isMissingPersistenceTable(e) ? "Create the favourites table in Supabase to persist saves." : e.message);
    }
  };

  const openEditor = (recipe = null) => {
    setEditingRecipe(recipe);
    setRecipeForm(recipe ? recipeToForm(recipe) : { ...EMPTY_RECIPE_FORM });
    setFormMessage("");
    setShowEditor(true);
    setSelectedRecipeId(null);
  };

  const closeEditor = () => { setShowEditor(false); setEditingRecipe(null); setRecipeForm({ ...EMPTY_RECIPE_FORM }); setFormMessage(""); };

  const updateForm = (field, value) => setRecipeForm((p) => ({ ...p, [field]: value }));

  const toggleFormArray = (field, value) => setRecipeForm((p) => {
    const arr = p[field];
    return { ...p, [field]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value] };
  });

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (!userId) { setFormMessage("Sign in to add recipes."); return; }
    if (parseLines(recipeForm.ingredientsText).length === 0 || parseLines(recipeForm.instructionsText).length === 0) {
      setFormMessage("Add at least one ingredient and one instruction step.");
      return;
    }
    setFormLoading(true); setFormMessage("");
    try {
      const payload = buildRecipePayload(recipeForm, userId);
      const req = editingRecipe
        ? supabase.from("recipes").update(payload).eq("id", editingRecipe.id).eq("user_id", userId)
        : supabase.from("recipes").insert(payload);
      const { error: e } = await req;
      if (e) throw e;
      setRefreshToken((t) => t + 1);
      closeEditor();
    } catch (err) {
      setFormMessage(err.message || "Could not save recipe.");
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async (recipe) => {
    if (!userId || recipe.ownerId !== userId) return;
    const { error: e } = await supabase.from("recipes").delete().eq("id", recipe.id).eq("user_id", userId);
    if (!e) { setSavedMealIds((prev) => prev.filter((id) => id !== recipe.id)); setRefreshToken((t) => t + 1); setSelectedRecipeId(null); }
  };

  // ── detail view ──
  if (activeRecipeId) {
    return (
      <RecipeDetail
        recipeId={activeRecipeId}
        userId={userId}
        savedMealIds={savedMealIds}
        isGuest={isGuest}
        session={session}
        onBack={() => {
          if (onExternalBack) {
            onExternalBack();
          } else {
            setSelectedRecipeId(null);
          }
        }}
        onToggleFavourite={toggleFavourite}
        onEdit={(recipe) => openEditor(recipe)}
        onDelete={async (recipe) => { await handleDelete(recipe); }}
        backLabel = {backLabel}
      />
    );
  }

  const tabs = [
    { id: "all",        label: `All (${recipes.length})`      },
    { id: "favourites", label: `Favourites (${savedMealIds.length})` },
    ...(!isGuest && userId ? [{ id: "mine", label: "My recipes" }] : []),
  ];

  return (
    <div className="space-y-6">
      {showEditor && (
        <RecipeEditor
          formData={recipeForm}
          isEditing={Boolean(editingRecipe)}
          loading={formLoading}
          message={formMessage}
          onCancel={closeEditor}
          onChange={updateForm}
          onSubmit={handleFormSubmit}
          onToggleAppliance={(v) => toggleFormArray("appliancesNeeded", v)}
          onToggleDietaryTag={(v) => toggleFormArray("dietaryTags", v)}
        />
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Discover recipes</h2>
            <p className="text-sm text-gray-500">
              {profile ? "Filtered by your budget and dietary preferences." : "Browse the recipe database."}
            </p>
          </div>
          {!isGuest && userId && (
            <button type="button" onClick={() => openEditor()}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
              Add your own recipe
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="space-y-3">
          <div className="mx-auto w-full max-w-3xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="space-y-4">
              <label
                htmlFor="today-time"
                className="block text-center text-sm font-semibold text-gray-700"
              >
                Cooking time filter
              </label>

              <div className="flex justify-center">
                <span className="rounded-full bg-emerald-100 px-4 py-2 text-base font-bold text-emerald-800">
                  {maxTime} min or less
                </span>
              </div>

              <input
                id="today-time"
                type="range"
                min="10"
                max="120"
                step="5"
                value={maxTime}
                onChange={(e) => setMaxTime(Number(e.target.value))}
                className="h-3 w-full cursor-pointer appearance-none rounded-full bg-gray-300 accent-emerald-600"
              />

              <div className="flex justify-between text-xs font-medium text-gray-400">
                <span>10 min</span>
                <span>2 hours</span>
              </div>
            </div>
          </div>

          <button type="button" onClick={() => setShowFilters((v) => !v)}
            className="flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-gray-700">
            <span>{showFilters ? "Hide filters" : "More filters"}</span>
            <svg className={`h-4 w-4 transition-transform ${showFilters ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showFilters && (
            <div className="grid gap-4 border-t border-gray-100 pt-4 md:grid-cols-2">
              <div className="space-y-1">
                <label className="block text-sm font-semibold text-gray-700">Cooking skill</label>
                <select value={cookingSkill} onChange={(e) => setCookingSkill(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm focus:border-emerald-500 focus:outline-none">
                  {COOKING_SKILL_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <span className="block text-sm font-semibold text-gray-700">Appliances</span>
                <div className="flex flex-wrap gap-2">
                  {APPLIANCE_OPTIONS.map((o) => (
                    <button key={o.id} type="button"
                      onClick={() => setSelectedAppliances((p) => p.includes(o.id) ? p.filter((a) => a !== o.id) : [...p, o.id])}
                      className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${selectedAppliances.includes(o.id) ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs + grid */}
      {error ? (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-1 w-fit rounded-xl border border-gray-200 bg-gray-50 p-1">
            {tabs.map((tab) => (
              <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${activeTab === tab.id ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                {tab.label}
              </button>
            ))}
          </div>

          {saveMessage && (
            <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">{saveMessage}</p>
          )}

          {loading ? (
            <div className="flex justify-center py-16">
              <p className="animate-pulse text-sm text-gray-400">Loading recipes…</p>
            </div>
          ) : visibleRecipes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 py-16 text-center">
              <p className="font-medium text-gray-400">
                {activeTab === "mine" ? "You haven't added any recipes yet." : activeTab === "favourites" ? "No favourites yet." : "No recipes match your filters."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {visibleRecipes.map((recipe) => {
                const openRecipe = () => {
                  trackStep("opened_recipe_from_grid");
                  const metrics = completeJourney(recipe.id);
                  persistJourney(metrics, supabase, session?.user?.id);
                  setSelectedRecipeId(recipe.id);
                };

                return (
                  <article
                    key={recipe.id}
                    role="button"
                    tabIndex={0}
                    onClick={openRecipe}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openRecipe();
                      }
                    }}
                    className="flex cursor-pointer flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition hover:border-emerald-300 hover:shadow-md"
                  >
                    {recipe.image && (
                      <img
                        src={recipe.image}
                        alt={recipe.title}
                        className="h-36 w-full object-cover"
                        loading="lazy"
                      />
                    )}

                    <div className="flex flex-1 flex-col p-5 space-y-3">
                      <div className="flex justify-between items-start gap-2">
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-700">
                          {formatMinutes(recipe.readyInMinutes)}
                        </span>

                        {recipe.estimatedCost && (
                          <span className="text-xs font-semibold text-gray-500">
                            {formatCost(recipe.estimatedCost)} / serving
                          </span>
                        )}
                      </div>

                      <p className="text-left text-lg font-bold leading-tight text-gray-900">
                        {recipe.title}
                      </p>

                      <p className="line-clamp-2 text-sm text-gray-500">
                        {recipe.description}
                      </p>

                      <div className="mt-auto flex flex-wrap gap-1 pt-2">
                        {recipe.cookingSkill && (
                          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-600">
                            {recipe.cookingSkill}
                          </span>
                        )}

                        {recipe.dietaryTags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded bg-gray-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-400"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="px-5 pb-5 pt-1 space-y-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleFavourite(recipe.id);
                        }}
                        className={`w-full rounded-lg px-3 py-2 text-xs font-bold transition ${
                          savedMealIds.includes(recipe.id)
                            ? "bg-rose-50 text-rose-700 hover:bg-rose-100"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                      >
                        {savedMealIds.includes(recipe.id) ? "Favourited" : "Favourite"}
                      </button>

                      {recipe.ownerId === userId && (
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openEditor(recipe);
                            }}
                            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50"
                          >
                            Edit
                          </button>

                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleDelete(recipe);
                            }}
                            className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

DiscoverView.propTypes = {
  isGuest: PropTypes.bool,
  session: PropTypes.shape({ user: PropTypes.shape({ id: PropTypes.string.isRequired }) }),
  profile: PropTypes.shape({
    budget: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    dietary_requirements: PropTypes.arrayOf(PropTypes.string),
  }),
};
