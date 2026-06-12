import { useEffect, useState, useCallback } from "react";
import { supabase } from "./lib/supabase";
import AuthView from "./components/AuthView";
import ProfileView from "./components/ProfileView";
import TodayView from "./components/TodayView";
import DiscoverView from "./components/DiscoverView";
import PlanView from "./components/PlanView";

import { startJourney, trackStep } from "./analytics";

const DEFAULT_BUDGET = 10;


const NAV_ITEMS = [
  { id: "today",    label: "Today"    },
  { id: "discover", label: "Discover" },
  { id: "plan",     label: "Plan"     },
];

export default function App() {
  const [session, setSession]       = useState(null);
  const [isGuest, setIsGuest]       = useState(false);
  const [loading, setLoading]       = useState(true);
  const [currentView, setCurrentView] = useState("today");
  const [profileData, setProfileData] = useState(null);
  const [selectedRecipeId, setSelectedRecipeId] = useState(null);
  const [recipeBackView, setRecipeBackView] = useState("discover");
  const [guestProfile, setGuestProfile] = useState({
    full_name: "Guest",
    username: "guest",
    dietary_requirements: [],
    budget: DEFAULT_BUDGET,
    weight_kg: "",
    height_cm: "",
    age: "",
    activity_level: "moderate",
    goal: "maintenance",
  });

  const openRecipe = (recipeId, backView = "discover") => {
    setSelectedRecipeId(recipeId);
    setRecipeBackView(backView);
    setCurrentView("recipe");
  };

  const fetchUserProfile = useCallback(async (userId) => {
    if (!userId) return;
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "dietary_requirements, budget, weight_kg, height_cm, age, activity_level, goal"
        )
        .eq("id", userId)
        .single();
      if (error) throw error;
      if (data) setProfileData({ ...data, budget: data.budget ?? DEFAULT_BUDGET });
    } catch (err) {
      console.error("Error fetching profile:", err instanceof Error ? err.message : err);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setSession(data.session);
      if (data.session?.user?.id) {
        setIsGuest(false);
        setCurrentView("today");
        fetchUserProfile(data.session.user.id);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, newSession) => {
      if (!isMounted) return;
      setSession(newSession);
      if (newSession?.user?.id) {
        setIsGuest(false);
        setCurrentView("today");
        fetchUserProfile(newSession.user.id);
      } else {
        setProfileData(null);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [fetchUserProfile]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="animate-pulse text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!session && !isGuest) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-6">
        <AuthView
          onContinueAsGuest={() => {
            startJourney();
            setIsGuest(true);
            setCurrentView("today");
          }}
        />
      </main>
    );
  }

  const profile = isGuest ? guestProfile : profileData;

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 text-gray-900">
      <nav className="sticky top-0 z-10 w-full border-b border-gray-200 bg-white px-6 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <span className="text-xl font-bold tracking-tight text-emerald-600">
            NutriSupport
          </span>

          <div className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  trackStep(`nav_${item.id}`);
                  setSelectedRecipeId(null);
                  setCurrentView(item.id);
                }}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                  currentView === item.id
                    ? "bg-emerald-50 text-emerald-700"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {item.label}
              </button>
            ))}

            <button
              type="button"
              onClick={() => setCurrentView("profile")}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                currentView === "profile"
                  ? "bg-emerald-50 text-emerald-700"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              Profile
            </button>

            {session ? (
              <button
                type="button"
                onClick={() => supabase.auth.signOut()}
                className="ml-2 rounded-lg px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
              >
                Sign out
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setIsGuest(false);
                  setCurrentView("profile");
                }}
                className="ml-2 rounded-lg px-4 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50"
              >
                Sign in
              </button>
            )}
          </div>
        </div>
      </nav>

      <main className="mx-auto w-full max-w-6xl flex-1 p-6">
        {currentView === "today" && (
          <TodayView
            profile={profile}
            session={session}
            isGuest={isGuest}
          />
        )}

        {currentView === "discover" && (
          <DiscoverView
            profile={profile}
            session={session}
            isGuest={isGuest}
          />
        )}

        {currentView === "plan" && (
          <PlanView
            profile={profile}
            session={session}
            isGuest={isGuest}
            onOpenRecipe={(recipeId) => openRecipe(recipeId, "plan")}
          />
        )}

        {currentView === "recipe" && (
          <DiscoverView
            profile={profile}
            session={session}
            isGuest={isGuest}
            externalRecipeId={selectedRecipeId}
            backLabel={recipeBackView === "plan" ? "Back to plan" : "Back to recipes"}
            onExternalBack={() => {
              setSelectedRecipeId(null);
              setCurrentView(recipeBackView);
            }}
          />
        )}

        {currentView === "profile" && (
          <div className="flex w-full items-start justify-center pt-8">
            <div className="w-full max-w-xl">
              <ProfileView
                session={session}
                initialProfile={isGuest ? guestProfile : null}
                onGuestProfileUpdate={setGuestProfile}
                onSignOut={() => {
                  setSession(null);
                  setIsGuest(false);
                  setCurrentView("today");
                }}
                onProfileUpdate={() => fetchUserProfile(session?.user?.id)}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
