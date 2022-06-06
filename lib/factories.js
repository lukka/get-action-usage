"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchPublicFactory = void 0;
const providers_1 = require("./providers");
class SearchPublicFactory {
    create(octokit, startDate, endDate, notification) {
        return __awaiter(this, void 0, void 0, function* () {
            const provider = new providers_1.SearchPublic(octokit, startDate, endDate, notification);
            if (!(yield provider.init())) {
                throw new Error('SearchPublic.init() failed');
            }
            return provider;
        });
    }
}
exports.SearchPublicFactory = SearchPublicFactory;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmFjdG9yaWVzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL2ZhY3Rvcmllcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFTQSwyQ0FBMkM7QUFFM0MsTUFBYSxtQkFBbUI7SUFDakIsTUFBTSxDQUNqQixPQUFtQixFQUNuQixTQUFlLEVBQ2YsT0FBYSxFQUNiLFlBQWtDOztZQUVsQyxNQUFNLFFBQVEsR0FBaUIsSUFBSSx3QkFBWSxDQUM3QyxPQUFPLEVBQ1AsU0FBUyxFQUNULE9BQU8sRUFDUCxZQUFZLENBQ2IsQ0FBQztZQUNGLElBQUksQ0FBQyxDQUFDLE1BQU0sUUFBUSxDQUFDLElBQUksRUFBRSxDQUFDLEVBQUU7Z0JBQzVCLE1BQU0sSUFBSSxLQUFLLENBQUMsNEJBQTRCLENBQUMsQ0FBQzthQUMvQztZQUNELE9BQU8sUUFBUSxDQUFDO1FBQ2xCLENBQUM7S0FBQTtDQUNGO0FBbEJELGtEQWtCQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIENvcHlyaWdodCDCqSAyMDIyIGJ5IEx1Y2EgQ2FwcGEgbGNhcHBhQGdtYWlsLmNvbVxuLy8gQWxsIGNvbnRlbnQgb2YgdGhpcyByZXBvc2l0b3J5IGlzIGxpY2Vuc2VkIHVuZGVyIHRoZSBDQyBCWS1TQSBMaWNlbnNlLlxuLy8gU2VlIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3QgZm9yIGxpY2Vuc2UgaW5mb3JtYXRpb24uXG5cbmltcG9ydCAqIGFzIG9rIGZyb20gJ0BvY3Rva2l0L3Jlc3QnO1xuaW1wb3J0IHtcbiAgSUFwaUNhbGxOb3RpZmljYXRpb24sXG4gIElSZXBvc2l0b3JpZXNQcm92aWRlckZhY3RvcnksXG59IGZyb20gJy4vaW50ZXJmYWNlcyc7XG5pbXBvcnQgeyBTZWFyY2hQdWJsaWMgfSBmcm9tICcuL3Byb3ZpZGVycyc7XG5cbmV4cG9ydCBjbGFzcyBTZWFyY2hQdWJsaWNGYWN0b3J5IGltcGxlbWVudHMgSVJlcG9zaXRvcmllc1Byb3ZpZGVyRmFjdG9yeSB7XG4gIHB1YmxpYyBhc3luYyBjcmVhdGUoXG4gICAgb2N0b2tpdDogb2suT2N0b2tpdCxcbiAgICBzdGFydERhdGU6IERhdGUsXG4gICAgZW5kRGF0ZTogRGF0ZSxcbiAgICBub3RpZmljYXRpb246IElBcGlDYWxsTm90aWZpY2F0aW9uXG4gICk6IFByb21pc2U8U2VhcmNoUHVibGljPiB7XG4gICAgY29uc3QgcHJvdmlkZXI6IFNlYXJjaFB1YmxpYyA9IG5ldyBTZWFyY2hQdWJsaWMoXG4gICAgICBvY3Rva2l0LFxuICAgICAgc3RhcnREYXRlLFxuICAgICAgZW5kRGF0ZSxcbiAgICAgIG5vdGlmaWNhdGlvblxuICAgICk7XG4gICAgaWYgKCEoYXdhaXQgcHJvdmlkZXIuaW5pdCgpKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdTZWFyY2hQdWJsaWMuaW5pdCgpIGZhaWxlZCcpO1xuICAgIH1cbiAgICByZXR1cm4gcHJvdmlkZXI7XG4gIH1cbn1cbiJdfQ==