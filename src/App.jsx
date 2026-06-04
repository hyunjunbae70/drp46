import { useEffect, useState, useCallback } from "react";
import { supabase } from "./lib/supabase";
import AuthView from "./components/AuthView";
import ProfileView from "./components/ProfileView";
import RecipeView from "./components/RecipeView";

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState("recipes");
  const [profileData, setProfileData] = useState(null);

  const fetchUserProfile = useCallback(async (userId) => {
    if (!userId) return;
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("dietary_requirements, budget")
        .eq("id", userId)
        .single();

      if (error) throw error;
      if (data) setProfileData(data);
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

  if (!session) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-6">
        <AuthView />
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col text-gray-900">
      <nav className="w-full bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center sticky top-0 z-10">
        <span className="text-xl font-bold text-emerald-600 tracking-tight">NutriSupport</span>
        
        <div className="flex items-center space-x-2">
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
          <button
            onClick={() => setCurrentView("recipes")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              currentView === "recipes" 
                ? "bg-emerald-50 text-emerald-700" 
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            Find Recipes
          </button>
          <button
            onClick={() => {
              supabase.auth.signOut();
              setSession(null);
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition"
          >
            Sign Out
          </button>
        </div>
      </nav>

      <main className="flex-1 w-full max-w-6xl mx-auto p-6">
        {currentView === "profile" ? (
          <div className="flex w-full justify-center items-start pt-8"> 
            <div className="w-full max-w-xl">
              <ProfileView 
                session={session} 
                onSignOut={() => setSession(null)} 
                onProfileUpdate={() => fetchUserProfile(session?.user?.id)} 
              />
            </div>
          </div>
        ) : (
          <RecipeView profile={profileData} />
        )}
      </main>
    </div>
  );
}
