# Real-browser test: L1 one-click draft (goal -> full graph -> prune -> apply)
from playwright.sync_api import sync_playwright

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
BASE = "http://127.0.0.1:8010/"


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROME)
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(BASE)
        page.wait_for_timeout(1200)

        print("== 1. draft button disabled before goal ==")
        print("  btn-draft disabled:", page.locator("#btn-draft").is_disabled())

        print("== 2. set goal -> draft enabled ==")
        page.fill(".wf-goal-input", "写一份季度财报分析")
        page.dispatch_event(".wf-goal-input", "input")
        page.locator(".wf-goal-input").blur()
        page.wait_for_timeout(300)
        print("  btn-draft disabled:", page.locator("#btn-draft").is_disabled())

        print("== 3. open draft overlay ==")
        page.click("#btn-draft")
        page.wait_for_timeout(1200)
        print("  overlay visible:", page.locator("#draft-overlay:not(.hidden)").count() > 0)
        goal_text = page.locator("#draft-goal").text_content()
        print("  draft goal shown:", "季度财报" in (goal_text or ""))
        items = page.locator("#draft-list .draft-item")
        n_items = items.count()
        print("  draft items:", n_items)
        checks = page.locator("#draft-list input[type=checkbox]").count()
        print("  checkboxes:", checks)

        print("== 4. uncheck last item, then apply ==")
        if checks > 0:
            page.locator("#draft-list input[type=checkbox]").nth(checks - 1).uncheck()
        page.click("#draft-apply")
        page.wait_for_timeout(500)
        nodes = page.evaluate("window.__wf.getNodes()")
        edges = page.evaluate("window.__wf.getEdges()")
        kinds = [n["kind"] for n in nodes]
        print("  nodes after apply:", len(nodes), "| kinds:", kinds)
        print("  edges after apply:", len(edges))
        root_has_goal = any(n["kind"] == "root" and n.get("goal") for n in nodes)
        print("  root goal preserved:", root_has_goal)

        print("== 5. JS errors ==")
        print("  ", errors if errors else "none")
        browser.close()


if __name__ == "__main__":
    main()
