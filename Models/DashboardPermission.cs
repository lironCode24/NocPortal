namespace NocPortal.Models
{
    public class DashboardPermission
    {
        public string DashboardId   { get; set; } = string.Empty;
        public string DashboardName { get; set; } = string.Empty;
    }

    public static class AvailableDashboards
    {
        public static readonly List<DashboardPermission> All = new()
        {
            new() { DashboardId = "alerts",         DashboardName = "NOC Events" },
            new() { DashboardId = "rack-metrics",   DashboardName = "Data Center" },
            new() { DashboardId = "suite-results",  DashboardName = "Suites Results" },
            new() { DashboardId = "recent-tests",   DashboardName = "Tests Results" },
            new() { DashboardId = "employee-tasks", DashboardName = "Manage Tasks" },
            new() { DashboardId = "servers",        DashboardName = "Servers & Systems" },
            new() { DashboardId = "systems-catalog",DashboardName = "Systems Catalog" },
            new() { DashboardId = "changes",        DashboardName = "Changes & CAB" },
            new() { DashboardId = "achievements",   DashboardName = "Achievements & Goals" },
            new() { DashboardId = "activities",   DashboardName = "Activities" },
            new() { DashboardId = "org-tree",   DashboardName = "IT Structure" },
        };
    }
}