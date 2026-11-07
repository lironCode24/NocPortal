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
        public Startup(IConfiguration configuration, IWebHostEnvironment env)
        {
            Configuration = configuration;
            PortalPaths.Initialize(env);
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

            // ── App services ────────────────────────────────────────
            services.AddSingleton<UserService>();
            services.AddSingleton<SystemMessageService>();
            services.AddSingleton<AuditLogService>();
            services.AddSingleton<EmailService>();
            services.AddSingleton<PasswordResetService>();
            services.AddSingleton<SecretsService>();
            services.AddHostedService<ValidationReminderService>();
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

            app.UseCookiePolicy();
            app.UseRouting();

            // ── סדר חשוב! ────────────────────────────────────────────
            app.UseAuthentication();
            app.UseAuthorization();

            app.UseEndpoints(endpoints =>
            {
                endpoints.MapControllerRoute(
                    name: "landing",
                    pattern: "",
                    defaults: new { controller = "Home", action = "Landing" });

                endpoints.MapControllerRoute(
                    name: "home",
                    pattern: "Home",
                    defaults: new { controller = "Home", action = "Index" });

                endpoints.MapControllerRoute(
                    name: "dashboards",
                    pattern: "Dashboards",
                    defaults: new { controller = "Dashboards", action = "Index" });

                endpoints.MapControllerRoute(
                    name: "systemValidate",
                    pattern: "SystemsCatalog/Validate/{id}",
                    defaults: new { controller = "SystemsCatalog", action = "Validate" });

                endpoints.MapControllerRoute(
                    name: "systemsCatalog",
                    pattern: "SystemsCatalog",
                    defaults: new { controller = "SystemsCatalog", action = "Index" });

                endpoints.MapControllerRoute(
                    name: "default",
                    pattern: "{controller=Auth}/{action=Login}/{id?}");
            });

            // ── אתחל UserService בהפעלה ──────────────────────────────
            app.ApplicationServices.GetRequiredService<UserService>();
        }
    }
}