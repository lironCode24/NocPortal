using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.AspNetCore.Authentication.Cookies;
using NocPortal.Services;

namespace MyWebApp
{
    public class Startup
    {
        public Startup(IConfiguration configuration)
        {
            Configuration = configuration;
        }

        public IConfiguration Configuration { get; }

        public void ConfigureServices(IServiceCollection services)
        {
            services.Configure<CookiePolicyOptions>(options =>
            {
                options.CheckConsentNeeded = context => false;
                options.MinimumSameSitePolicy = SameSiteMode.None;
            });

            services.AddControllersWithViews();
            services.AddHttpClient();

            services.AddScoped<SuiteConfigController>();

            // ── Authentication ───────────────────────────────────────
            services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
                .AddCookie(options =>
                {
                    options.LoginPath        = "/Auth/Login";
                    options.LogoutPath       = "/Auth/Logout";
                    options.AccessDeniedPath = "/Auth/AccessDenied";
                    options.ExpireTimeSpan   = System.TimeSpan.FromHours(8);
                    options.SlidingExpiration = true;
                    options.Cookie.Name      = "NocPortal.Auth";
                    options.Cookie.HttpOnly  = true;
                    options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
                });

            // ── Authorization + Policies ─────────────────────────────
            services.AddAuthorization(options =>
            {
                // רק NOC
                options.AddPolicy("NocOnly", policy =>
                    policy.RequireRole("NOC", "Admin"));

                // NOC או DASHBOARD
                options.AddPolicy("DashboardAccess", policy =>
                    policy.RequireRole("NOC", "DASHBOARD", "Admin"));
            });

            // ── UserService ──────────────────────────────────────────
            services.AddSingleton<UserService>();
        }

        public void Configure(IApplicationBuilder app, IWebHostEnvironment env)
        {
            if (env.IsDevelopment())
            {
                app.UseDeveloperExceptionPage();
            }
            else
            {
                app.UseExceptionHandler("/Home/Error");
                app.UseHsts();
            }

            app.UseHttpsRedirection();
            app.UseStaticFiles();

            // Font Awesome מהתיקייה המשותפת
            app.UseStaticFiles(new StaticFileOptions
            {
                FileProvider = new PhysicalFileProvider(@"C:\Users\liron\Desktop\automation\Noc Portal\NocPortal\NocPortal\portal\fontawesome"),

                RequestPath = "/fontawesome"
            });

            app.UseCookiePolicy();
            app.UseRouting();

            // ── סדר חשוב! ────────────────────────────────────────────
            app.UseAuthentication();
            app.UseAuthorization();

            app.UseEndpoints(endpoints =>
            {
                endpoints.MapControllerRoute(
                    name: "home",
                    pattern: "Home",
                    defaults: new { controller = "Home", action = "Index" });

                endpoints.MapControllerRoute(
                    name: "dashboards",
                    pattern: "Dashboards",
                    defaults: new { controller = "Dashboards", action = "Index" });

                endpoints.MapControllerRoute(
                    name: "default",
                    pattern: "{controller=Auth}/{action=Login}/{id?}");
            });

            // ── אתחל UserService בהפעלה ──────────────────────────────
            app.ApplicationServices.GetRequiredService<UserService>();
        }
    }
}