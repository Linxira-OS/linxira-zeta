pluginManagement {
    repositories {
        if (providers.gradleProperty("zeta.useAliyunMirrors").orNull == "true") {
            maven("https://maven.aliyun.com/repository/gradle-plugin")
            maven("https://maven.aliyun.com/repository/google")
            maven("https://maven.aliyun.com/repository/central")
        }
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    val useAliyunMirrors = providers.gradleProperty("zeta.useAliyunMirrors").orNull == "true"
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        if (useAliyunMirrors) {
            maven("https://maven.aliyun.com/repository/google")
            maven("https://maven.aliyun.com/repository/central")
        }
        google()
        mavenCentral()
    }
}

rootProject.name = "zeta-android"
include(":app")
