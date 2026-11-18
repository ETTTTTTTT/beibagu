plugins {
  id("java")
  id("org.jetbrains.kotlin.jvm") version "1.9.24"
  id("org.jetbrains.intellij.platform") version "2.1.0"
}

group = "com.huaxin"
version = "0.1.64"

repositories {
  mavenCentral()
  intellijPlatform {
    defaultRepositories()
  }
}

dependencies {
  intellijPlatform {
    intellijIdeaCommunity("2024.1")
  }
  implementation("com.google.code.gson:gson:2.11.0")
}

kotlin {
  jvmToolchain(17)
}

intellijPlatform {
  instrumentCode.set(false)
  pluginConfiguration {
    name.set("面试背题")
    version.set(project.version.toString())
    ideaVersion {
      sinceBuild.set("241")
      untilBuild.set("269.*")
    }
  }
  publishing {
    // JetBrains Marketplace permanent token:
    // https://plugins.jetbrains.com/author/me/tokens
    token.set(providers.environmentVariable("JETBRAINS_MARKETPLACE_TOKEN"))
  }
}

tasks {
  buildSearchableOptions {
    enabled = false
  }
}
