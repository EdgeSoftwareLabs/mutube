YOUTUBE_IPA := ./ipa/YouTube_4.54.01_decrypted.ipa
OUTPUT_IPA := ./youtube-plus.ipa
PATCHER_FLAGS :=

ifneq ($(PRINTF_LOGS),)
ifneq ($(PRINTF_LOGS),0)
PATCHER_FLAGS += --enable-printf-logs
endif
endif

# make ICONS=1 : also replace the app icon / top shelf (macOS + Xcode, experimental)
ifneq ($(ICONS),)
ifneq ($(ICONS),0)
PATCHER_FLAGS += --tvos-icons platforms/tvos/Assets.xcassets
endif
endif

# make EMBED=0 : load youtube-plus.js from jsDelivr instead of embedding it
ifeq ($(EMBED),0)
PATCHER_FLAGS += --no-embed-youtube-plus
endif

.PHONY: all
all: $(OUTPUT_IPA)

$(OUTPUT_IPA): $(YOUTUBE_IPA) patcher.py inject.js youtube-plus.js
	uv run patcher.py --in $(YOUTUBE_IPA) --out $(OUTPUT_IPA) $(PATCHER_FLAGS)

.PHONY: icons
icons:
	python3 icons/generate_icons.py

.PHONY: test
test:
	node tests/simulate.js

.PHONY: clean
clean:
	rm -f $(OUTPUT_IPA)
