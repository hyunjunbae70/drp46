import { useEffect, useState, useCallback } from "react";
import { supabase } from "./lib/supabase";
import AuthView from "./components/AuthView";
import ProfileView from "./components/ProfileView";
import RecipeView from "./components/RecipeView";

// Metric tracking functionality
import { startJourney, trackStep } from "./analytics";

const DEFAULT_BUDGET = 10;

export default function App() {
  const [session, setSession] = useState(null);
  const [isGuest, setIsGuest] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState("recipes");
  const [profileData, setProfileData] = useState(null);
  const [guestProfile, setGuestProfile] = useState({
    full_name: "Guest",
    username: "guest",
    dietary_requirements: [],
    budget: DEFAULT_BUDGET,
  });

  const fetchUserProfile = useCallback(async (userId) => {
    if (!userId) return;
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("dietary_requirements, budget")
        .eq("id", userId)
        .single();

      if (error) throw error;
      if (data) {
        setProfileData({
          ...data,
          budget: data.budget ?? DEFAULT_BUDGET,
        });
      }
    } catch (err) {
      console.error("Error fetching sync preferences:", err instanceof Error ? err.message : err);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    // Get initial session cleanly
    supabase.auth.getSession().then(({ data }) => {
      if (isMounted) {
        setSession(data.session);
        if (data.session?.user?.id) {
          setIsGuest(false);
          setCurrentView("recipes");
          fetchUserProfile(data.session.user.id);
        }
        setLoading(false);
      }
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, newSession) => {
      if (isMounted) {
        setSession(newSession);
        if (newSession?.user?.id) {
          setIsGuest(false);
          setCurrentView("recipes");
          fetchUserProfile(newSession.user.id);
        } else {
          setProfileData(null);
        }
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
        <p className="text-gray-500 animate-pulse">Loading...</p>
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
            setCurrentView("recipes");
          }}
        />
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col text-gray-900">
      <nav className="w-full bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center sticky top-0 z-10">
        <span className="text-xl font-bold text-emerald-600 tracking-tight">NutriSupport</span>
        
        <div className="flex items-center space-x-2">
          {(session || isGuest) && (
            <button
              onClick={() => setCurrentView("profile")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                currentView === "profile" 
                  ? "bg-emerald-50 text-emerald-700" 
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              Profile Settings
            </button>
          )}
          <button
            onClick={() => {
              trackStep("opened_recipes");
              setCurrentView("recipes");
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              currentView === "recipes" 
                ? "bg-emerald-50 text-emerald-700" 
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            Find Recipes
          </button>
          {session ? (
            <button
              onClick={() => {
                supabase.auth.signOut();
                setSession(null);
              }}
              className="px-4 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition"
            >
              Sign Out
            </button>
          ) : (
            <button
              onClick={() => {
                setIsGuest(false);
                setCurrentView("profile");
              }}
              className="px-4 py-2 rounded-lg text-sm font-medium text-emerald-700 hover:bg-emerald-50 transition"
            >
              Sign In
            </button>
          )}
        </div>
      </nav>

      <main className="flex-1 w-full max-w-6xl mx-auto p-6">
        {(session || isGuest) && currentView === "profile" ? (
          <div className="flex w-full justify-center items-start pt-8"> 
            <div className="w-full max-w-xl">
              <ProfileView 
                session={session} 
                initialProfile={isGuest ? guestProfile : null}
                onGuestProfileUpdate={setGuestProfile}
                onSignOut={() => {
                  setSession(null);
                  setIsGuest(false);
                  setCurrentView("profile");
                }} 
                onProfileUpdate={() => fetchUserProfile(session?.user?.id)} 
              />
            </div>
          </div>
        ) : (
          <RecipeView
            profile={isGuest ? guestProfile : profileData}
            session={session}
            isGuest={isGuest}
          />
        )}
      </main>
    </div>
  );
}
