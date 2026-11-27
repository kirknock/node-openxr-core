/* Ground-truth bisector: suggests khr/simple_controller bindings through the
 * system loader against the live Monado, in plain C. If this fails with -22
 * too, the runtime state is the cause; if it succeeds, the JS marshalling is.
 * Build: gcc -I third_party/openxr third_party/openxr/bindings-test.c -o /tmp/xr-bt -l:libopenxr_loader.so.1
 */
#include <openxr.h>
#include <stdio.h>
#include <string.h>

static XrInstance instance;

static XrPath P(const char *s) {
    XrPath p = XR_NULL_PATH;
    XrResult r = xrStringToPath(instance, s, &p);
    printf("path %-55s -> %llu (r=%d)\n", s, (unsigned long long)p, r);
    return p;
}

int main(void) {
    XrApplicationInfo app = {0};
    strcpy(app.applicationName, "bindings-test");
    app.apiVersion = XR_MAKE_VERSION(1, 0, 0);
    XrInstanceCreateInfo ci = {.type = XR_TYPE_INSTANCE_CREATE_INFO, .next = NULL};
    ci.applicationInfo = app;
    XrResult r = xrCreateInstance(&ci, &instance);
    printf("xrCreateInstance r=%d\n", r);
    if (r != XR_SUCCESS) return 1;

    XrPath left = P("/user/hand/left");
    XrPath right = P("/user/hand/right");
    XrPath subactions[2] = {left, right};

    XrActionSetCreateInfo asci = {.type = XR_TYPE_ACTION_SET_CREATE_INFO, .next = NULL};
    strcpy(asci.actionSetName, "test");
    strcpy(asci.localizedActionSetName, "Test");
    XrActionSet actionSet = XR_NULL_HANDLE;
    r = xrCreateActionSet(instance, &asci, &actionSet);
    printf("xrCreateActionSet r=%d set=%llu\n", r, (unsigned long long)(size_t)actionSet);
    if (r != XR_SUCCESS) return 1;

    XrActionCreateInfo aci = {.type = XR_TYPE_ACTION_CREATE_INFO, .next = NULL};
    strcpy(aci.actionName, "select");
    strcpy(aci.localizedActionName, "select");
    aci.actionType = XR_ACTION_TYPE_BOOLEAN_INPUT;
    aci.countSubactionPaths = 2;
    aci.subactionPaths = subactions;
    XrAction selectAction = XR_NULL_HANDLE;
    r = xrCreateAction(actionSet, &aci, &selectAction);
    printf("xrCreateAction(boolean) r=%d action=%llu\n", r, (unsigned long long)(size_t)selectAction);
    if (r != XR_SUCCESS) return 1;

    XrActionSuggestedBinding bindings[2] = {
        {selectAction, P("/user/hand/left/input/select/click")},
        {selectAction, P("/user/hand/right/input/select/click")},
    };
    XrInteractionProfileSuggestedBinding sb = {
        .type = XR_TYPE_INTERACTION_PROFILE_SUGGESTED_BINDING,
        .next = NULL,
    };
    sb.interactionProfile = P("/interaction_profiles/khr/simple_controller");
    sb.countSuggestedBindings = 2;
    sb.suggestedBindings = bindings;
    r = xrSuggestInteractionProfileBindings(instance, &sb);
    printf("xrSuggestInteractionProfileBindings(simple) r=%d  <<< %s\n", r,
           r == XR_SUCCESS ? "SUCCESS" : (r == -22 ? "PATH_UNSUPPORTED" : "OTHER"));
    return r == XR_SUCCESS ? 0 : 2;
}
